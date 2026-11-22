import { parseConfig, safeMessage, type AppConfig } from './config.ts';
import { openDriver, type Driver } from './db.ts';
import type { DriverFactory } from './execute.ts';
import { SCHEDULER_NAME } from './schedule.ts';

export const STATUS_CACHE_TTL_MS = 20_000;

const API_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;

interface StatusCacheSlot {
  cached?: { key: string; body: string; expiresAt: number };
  inFlight?: { key: string; promise: Promise<string> };
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

async function buildStatusBody(
  settings: AppConfig,
  env: Env,
  factory: DriverFactory,
  readNextTimes: () => Promise<Record<string, string>>,
): Promise<string> {
  let nextTimes: Record<string, string> = {};
  try {
    nextTimes = await readNextTimes();
  } catch (error) {
    console.error(JSON.stringify({ event: 'status_schedule_error', error: safeMessage(error) }));
  }
  const instances = await mapLimited(settings.databases, async config => {
    const nextTime = Object.hasOwn(nextTimes, config.id) ? nextTimes[config.id]! : null;
    const base = { id: config.id, name: config.name, type: config.type, region: config.region, next_time: nextTime };
    let driver: Driver | undefined;
    try {
      driver = await factory(config, env);
      const history = await driver.latest();
      return { ...base, history, last_status: history[0]?.status ?? 'EMPTY' };
    } catch (error) {
      return { ...base, history: [], last_status: 'FAILED', error: safeMessage(error) };
    } finally { await driver?.close(); }
  });
  return JSON.stringify({ timezone: settings.timezone, instances });
}

export async function handleRequest(
  request: Request,
  env: Env,
  factory: DriverFactory = openDriver,
  readNextTimes: () => Promise<Record<string, string>> = () => env.SCHEDULER.getByName(SCHEDULER_NAME).nextTimes(),
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  const head = request.method === 'HEAD';
  if (path !== '/api/status') return json({ error: 'Not found' }, 404, head);
  if (request.method !== 'GET' && !head) return json({ error: 'Method not allowed' }, 405, false, { Allow: 'GET, HEAD' });
  try {
    const settings = parseConfig(env.CONFIG);
    const defaultSchema: unknown = Reflect.get(env, 'SUPABASE_SCHEMA');
    const cacheKey = `${env.CONFIG}\0${typeof defaultSchema === 'string' ? defaultSchema : ''}`;
    const slot = getCacheSlot(factory);
    if (slot.cached && slot.cached.key === cacheKey && Date.now() < slot.cached.expiresAt) {
      return jsonText(slot.cached.body, 200, head, { 'Cache-Control': 'public, max-age=15' });
    }
    let pending = slot.inFlight?.key === cacheKey ? slot.inFlight.promise : undefined;
    if (!pending) {
      const entry: { key: string; promise: Promise<string> } = { key: cacheKey, promise: undefined as unknown as Promise<string> };
      const created = buildStatusBody(settings, env, factory, readNextTimes)
        .then(body => {
          slot.cached = { key: cacheKey, body, expiresAt: Date.now() + STATUS_CACHE_TTL_MS };
          return body;
        })
        .finally(() => {
          if (slot.inFlight === entry) slot.inFlight = undefined;
        });
      entry.promise = created;
      slot.inFlight = entry;
      ctx?.waitUntil(created.catch(() => {}));
      pending = created;
    }
    const body = await pending;
    return jsonText(body, 200, head, { 'Cache-Control': 'public, max-age=15' });
  } catch (error) { return json({ error: safeMessage(error) }, 500, head); }
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env, openDriver, undefined, ctx); },
  async scheduled(_controller, env) { await env.SCHEDULER.getByName(SCHEDULER_NAME).wake(); },
} satisfies ExportedHandler<Env>;
