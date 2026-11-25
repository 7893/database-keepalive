import { parseConfig, safeMessage, type AppConfig } from './config.ts';
import { openDriver, type Driver } from './db.ts';
import type { DriverFactory } from './execute.ts';
import { SCHEDULER_NAME } from './schedule.ts';
import type { ScheduleIssue } from './scheduler-runner.ts';

export const STATUS_CACHE_TTL_MS = 20_000;
const HTTP_CACHE_MAX_AGE_S = 15;
const CHECKIN_CACHE_BUFFER_MS = 2_000;

export type ScheduleSnapshot = { nextTimes: Record<string, string>; issues?: Record<string, ScheduleIssue> };
export type ScheduleReader = () => Promise<Record<string, string> | ScheduleSnapshot>;

const API_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;

// Cache only settled plain-string snapshots (never in-flight I/O Promises)
// to stay compliant with Cloudflare Workers per-request I/O isolation.
interface StatusCacheSlot {
  cached?: { key: string; body: string; expiresAt: number };
}
const statusCaches = new WeakMap<DriverFactory, StatusCacheSlot>();

function getCacheSlot(factory: DriverFactory): StatusCacheSlot {
  let slot = statusCaches.get(factory);
  if (!slot) {
    slot = {};
    statusCaches.set(factory, slot);
  }
  return slot;
}

async function hashCacheKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isScheduleSnapshot(value: Record<string, string> | ScheduleSnapshot): value is ScheduleSnapshot {
  return 'nextTimes' in value && typeof value.nextTimes === 'object' && value.nextTimes !== null;
}

function jsonText(body: string, status = 200, head = false, extraHeaders?: Record<string, string>): Response {
  return new Response(head ? null : body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function json(data: unknown, status = 200, head = false, extraHeaders?: Record<string, string>): Response {
  return jsonText(JSON.stringify(data), status, head, extraHeaders);
}

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

const STATUS_DUE_CACHE_TTL_MS = 5_000;
const STATUS_DUE_WINDOW_MS = 60_000;

function computeCacheExpiry(now: number, nextTimes: Record<string, string>): number {
  let expiresAt = now + STATUS_CACHE_TTL_MS;
  for (const iso of Object.values(nextTimes)) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) continue;
    if (time + CHECKIN_CACHE_BUFFER_MS > now && time + CHECKIN_CACHE_BUFFER_MS < expiresAt) {
      expiresAt = time + CHECKIN_CACHE_BUFFER_MS;
    } else if (time <= now && now - time < STATUS_DUE_WINDOW_MS) {
      expiresAt = Math.min(expiresAt, now + STATUS_DUE_CACHE_TTL_MS);
    }
  }
  return expiresAt;
}

function cacheControlHeader(now: number, expiresAt: number): string {
  const seconds = Math.max(1, Math.min(HTTP_CACHE_MAX_AGE_S, Math.ceil((expiresAt - now) / 1000)));
  return `public, max-age=${seconds}`;
}

async function buildStatusBody(
  settings: AppConfig,
  env: Env,
  factory: DriverFactory,
  readSchedule: ScheduleReader,
): Promise<{ body: string; degraded: boolean; nextTimes: Record<string, string> }> {
  let nextTimes: Record<string, string> = {};
  let issues: Record<string, ScheduleIssue> = {};
  let scheduleFailed = false;
  try {
    const result = await readSchedule();
    if (isScheduleSnapshot(result)) {
      nextTimes = result.nextTimes;
      issues = result.issues ?? {};
    } else {
      nextTimes = result;
    }
  } catch (error) {
    scheduleFailed = true;
    console.error(JSON.stringify({ event: 'status_schedule_error', error: safeMessage(error) }));
  }
  const instances = await mapLimited(settings.databases, async config => {
    const nextTime = Object.hasOwn(nextTimes, config.id) ? nextTimes[config.id]! : null;
    const scheduleIssue = Object.hasOwn(issues, config.id) ? issues[config.id] : undefined;
    const base = {
      id: config.id,
      name: config.name,
      type: config.type,
      region: config.region,
      next_time: nextTime,
      ...(scheduleIssue ? { schedule_issue: scheduleIssue } : {}),
    };
    let driver: Driver | undefined;
    try {
      driver = await factory(config, env);
      const history = await driver.latest();
      return { ...base, history, last_status: history[0]?.status ?? 'EMPTY' };
    } catch (error) {
      return { ...base, history: [], last_status: 'FAILED', error: safeMessage(error) };
    } finally { await driver?.close(); }
  });
  const degraded = scheduleFailed || instances.some(inst => inst.last_status === 'FAILED');
  return { body: JSON.stringify({ timezone: settings.timezone, instances }), degraded, nextTimes };
}

export async function handleRequest(
  request: Request,
  env: Env,
  factory: DriverFactory = openDriver,
  readSchedule: ScheduleReader = () => env.SCHEDULER.getByName(SCHEDULER_NAME).status(),
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  const head = request.method === 'HEAD';
  if (path !== '/api/status') return json({ error: 'Not found' }, 404, head);
  if (request.method !== 'GET' && !head) return json({ error: 'Method not allowed' }, 405, false, { Allow: 'GET, HEAD' });
  try {
    const settings = parseConfig(env.CONFIG);
    const defaultSchema: unknown = Reflect.get(env, 'SUPABASE_SCHEMA');
    const cacheKey = await hashCacheKey(`${env.CONFIG}\0${typeof defaultSchema === 'string' ? defaultSchema : ''}`);
    const slot = getCacheSlot(factory);
    const now = Date.now();
    if (slot.cached && slot.cached.key === cacheKey && now < slot.cached.expiresAt) {
      return jsonText(slot.cached.body, 200, head, { 'Cache-Control': cacheControlHeader(now, slot.cached.expiresAt) });
    }
    const { body, degraded, nextTimes } = await buildStatusBody(settings, env, factory, readSchedule);
    if (degraded) {
      if (slot.cached?.key === cacheKey) slot.cached = undefined;
      return jsonText(body, 200, head);
    }
    const builtAt = Date.now();
    const expiresAt = computeCacheExpiry(builtAt, nextTimes);
    slot.cached = { key: cacheKey, body, expiresAt };
    return jsonText(body, 200, head, { 'Cache-Control': cacheControlHeader(builtAt, expiresAt) });
  } catch (error) { return json({ error: safeMessage(error) }, 500, head); }
}

export default {
  async fetch(request, env) { return handleRequest(request, env); },
  async scheduled(_controller, env) { await env.SCHEDULER.getByName(SCHEDULER_NAME).wake(); },
} satisfies ExportedHandler<Env>;
