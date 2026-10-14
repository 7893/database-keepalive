import { dailyPolicy, SafeError, type AppConfig } from './config.ts';

export const DAY = 86_400_000;
export const INTERVAL = 5 * 60_000; // Failure retry delay; Cron is only a watchdog.
export const RETRY_WINDOW = 15 * 60_000;
export const MIN_GAP = 1000;
export const SCHEDULER_NAME = 'all-databases-v2';
export type PlanNode = { id: string; policy: { min: number; max: number } };
export type PlannedEvent = { databaseId: string; time: number };
export const utcDay = (time: number) => Math.floor(time / DAY) * DAY;
export const planNodes = (config: AppConfig): PlanNode[] => config.databases.map(node => ({
  id: node.id, policy: dailyPolicy(node.dailyCheckins ?? config.dailyCheckins),
}));

// Deterministic PRNG, seeded by SHA-256. This is scheduling randomness, not a secret.
async function randomFor(key: string): Promise<(limit: number) => number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  let state = new DataView(digest).getUint32(0);
  const next = () => {
    let value = state = (state + 0x6D2B79F5) >>> 0;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return (value ^ value >>> 14) >>> 0;
  };
  return limit => {
    const ceiling = 0x100000000 - 0x100000000 % limit;
    let value: number;
    do { value = next(); } while (value >= ceiling);
    return value % limit;
  };
}

// Shuffle database tickets across disjoint second-resolution windows. Every node
// gets its exact sampled count, and no two nodes can receive the same second.
export async function fleetPlan(nodes: PlanNode[], day: number): Promise<PlannedEvent[]> {
  const midnight = utcDay(day);
  const ordered = [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tickets: string[] = [];
  for (const node of ordered) {
    const random = await randomFor(`count-v2:${node.id}:${midnight}`);
    const count = node.policy.min + random(node.policy.max - node.policy.min + 1);
    for (let i = 0; i < count; i++) tickets.push(node.id);
  }
  if (tickets.length > DAY / MIN_GAP) throw new SafeError('Too many daily check-ins for distinct second-level scheduling.');
  if (!tickets.length) return [];
  const random = await randomFor(`plan-v2:${midnight}:${JSON.stringify(ordered)}`);
  for (let i = tickets.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [tickets[i], tickets[j]] = [tickets[j]!, tickets[i]!];
  }
  return tickets.map((databaseId, i) => {
    const start = Math.floor(i * 86400 / tickets.length);
    const end = Math.floor((i + 1) * 86400 / tickets.length);
    return { databaseId, time: midnight + (start + random(end - start)) * 1000 };
  });
}

// Single-node convenience used in tests and tools; production always plans the fleet.
export async function dailyPlan(id: string, day: number, policy: PlanNode['policy']): Promise<number[]> {
  return (await fleetPlan([{ id, policy }], day)).map(event => event.time);
}

// UUID-shaped keys fit all three existing schemas, including Oracle VARCHAR2(36).
export async function requestId(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 0x50;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
