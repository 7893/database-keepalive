import { timingSafeEqual } from 'node:crypto';
import { parseDatabases, safeMessage, schedulePolicy, type DatabaseConfig } from './config.ts';
import { checkin, openDriver, type Driver } from './db.ts';
import { dueTimes, nextTime, requestId } from './schedule.ts';

export type DriverFactory = (config: DatabaseConfig, env: Env) => Promise<Driver>;
export function authorized(request: Request, secret: string): boolean {
  if (!secret || secret.length < 32) return false;
  const supplied = Buffer.from(request.headers.get('Authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function writeOne(config: DatabaseConfig, env: Env, id: string, factory: DriverFactory = openDriver) {
  let driver: Driver | undefined;
  const start = Date.now();
  try {
    driver = await factory(config, env);
    const record = await checkin(driver, id);
    return { ok: true, record, duration_ms: Date.now() - start };
  } catch (error) {
    return { ok: false, error: safeMessage(error), duration_ms: Date.now() - start };
  } finally { await driver?.close(); }
}

// Use the event timestamp so a delayed/duplicate delivery retains its original ID.
export async function runScheduled(env: Env, now: number, factory: DriverFactory = openDriver): Promise<void> {
  const configs = parseDatabases(env.DATABASES);
  const policy = schedulePolicy(env.DAILY_MIN, env.DAILY_MAX);
  let failed = false;
  // Bounded sequential work avoids bursts of simultaneous origin connections.
  for (const config of configs) {
    for (const time of await dueTimes(config.id, now, policy)) {
      const id = await requestId(`scheduled-v1:${config.id}:${time}`);
      const result = await writeOne(config, env, id, factory);
      console.log(JSON.stringify({ event: 'scheduled_checkin', service: config.id, request_id: id, ...result }));
      failed ||= !result.ok;
    }
  }
  if (failed) throw new Error('One or more check-ins failed; the following ticks retry within 15 minutes.');
}

export async function handleRequest(request: Request, env: Env, factory: DriverFactory = openDriver): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (path !== '/api/status' && path !== '/api/trigger') return json({ error: 'Not found' }, 404);
  if ((path === '/api/status' && request.method !== 'GET') || (path === '/api/trigger' && request.method !== 'POST')) {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (path === '/api/trigger' && !authorized(request, env.TRIGGER_SECRET)) return json({ error: 'Administrator key required.' }, 401);
  try {
    const configs = parseDatabases(env.DATABASES);
    const policy = schedulePolicy(env.DAILY_MIN, env.DAILY_MAX);
    if (path === '/api/trigger') {
      const key = request.headers.get('Idempotency-Key');
      if (!key || !/^[a-zA-Z0-9_-]{16,80}$/.test(key)) return json({ error: 'Supply an Idempotency-Key of 16–80 letters, digits, underscores or hyphens.' }, 400);
      const results: Record<string, Awaited<ReturnType<typeof writeOne>>> = {};
      await Promise.all(configs.map(async config => { results[config.id] = await writeOne(config, env, await requestId(`manual-v1:${config.id}:${key}`), factory); }));
      const success = Object.values(results).every(result => result.ok);
      return json({ success, results }, success ? 200 : 502);
    }
    const instances = await Promise.all(configs.map(async config => {
      const base = { id: config.id, name: config.name, type: config.type, region: config.region, next_time: await nextTime(config.id, Date.now(), policy) };
      let driver: Driver | undefined;
      try {
        driver = await factory(config, env);
        const history = await driver.latest();
        return { ...base, history, last_status: history[0]?.status ?? 'EMPTY' };
      } catch (error) {
        return { ...base, history: [], last_status: 'FAILED', error: safeMessage(error) };
      } finally { await driver?.close(); }
    }));
    return json({ timezone: env.DISPLAY_TIMEZONE, instances });
  } catch (error) { return json({ error: safeMessage(error) }, 500); }
}

export default {
  async fetch(request, env) { return handleRequest(request, env); },
  async scheduled(controller, env) { await runScheduled(env, controller.scheduledTime); },
} satisfies ExportedHandler<Env>;
