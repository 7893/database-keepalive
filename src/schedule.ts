const DAY = 86_400_000;
export const INTERVAL = 5 * 60_000;
export const RETRY_WINDOW = 15 * 60_000;

// Stable across isolates and deployments. Scheduling days are always UTC.
export async function dailyPlan(id: string, day: number, policy: { min: number; max: number }): Promise<number[]> {
  const midnight = Math.floor(day / DAY) * DAY;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`plan-v1:${id}:${midnight}`));
  const seed = new DataView(digest).getUint32(0);
  const count = policy.min + seed % (policy.max - policy.min + 1);
  // One event in each evenly-spaced window. Leave 15 minutes between events
  // so one event's bounded retry window cannot overlap another's.
  const slots = DAY / INTERVAL, width = Math.floor(slots / count);
  return Array.from({ length: count }, (_, i) => {
    const mixed = (Math.imul(seed ^ (i + 1), 0x45d9f3b) >>> 0);
    return midnight + (i * width + mixed % (width - 3)) * INTERVAL;
  });
}

export async function dueTimes(id: string, now: number, policy: { min: number; max: number }): Promise<number[]> {
  const plans = await Promise.all([dailyPlan(id, now - DAY, policy), dailyPlan(id, now, policy)]);
  return plans.flat().filter(time => time <= now && time > now - RETRY_WINDOW);
}

export async function nextTime(id: string, now: number, policy: { min: number; max: number }): Promise<string> {
  const plans = await Promise.all([dailyPlan(id, now, policy), dailyPlan(id, now + DAY, policy)]);
  return new Date(plans.flat().find(time => time > now)!).toISOString();
}

// UUID-shaped keys fit all three existing schemas, including Oracle VARCHAR2(36).
export async function requestId(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 0x50;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
