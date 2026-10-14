import { parseConfig, safeMessage, dailyPolicy, type DatabaseConfig } from './config.ts';
import { checkin, openDriver, type Driver } from './db.ts';
import { dueTimes, nextTime, requestId } from './schedule.ts';

export type DriverFactory = (config: DatabaseConfig, env: Env) => Promise<Driver>;
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
  const settings = parseConfig(env.CONFIG);
  const configs = settings.databases;
  let failed = false;
  // Bounded sequential work avoids bursts of simultaneous origin connections.
  for (const config of configs) {
    const policy = dailyPolicy(config.dailyCheckins ?? settings.dailyCheckins);
    for (const time of await dueTimes(config.id, now, policy)) {
      const id = await requestId(`scheduled-v1:${config.id}:${time}`);
      const result = await writeOne(config, env, id, factory);
      console.log(JSON.stringify({ event: 'scheduled_checkin', service: config.id, request_id: id, ...result }));
      failed ||= !result.ok;
    }
  }
  if (failed) throw new Error('One or more check-ins failed; the following ticks retry within 15 minutes.');
}

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

export async function handleRequest(request: Request, env: Env, factory: DriverFactory = openDriver): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (path !== '/api/status') return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const settings = parseConfig(env.CONFIG);
    const configs = settings.databases;
    const instances = await mapLimited(configs, async config => {
      const policy = dailyPolicy(config.dailyCheckins ?? settings.dailyCheckins);
      const base = { id: config.id, name: config.name, type: config.type, region: config.region, next_time: await nextTime(config.id, Date.now(), policy) };
      let driver: Driver | undefined;
      try {
        driver = await factory(config, env);
        const history = await driver.latest();
        return { ...base, history, last_status: history[0]?.status ?? 'EMPTY' };
      } catch (error) {
        return { ...base, history: [], last_status: 'FAILED', error: safeMessage(error) };
      } finally { await driver?.close(); }
    });
    return json({ timezone: settings.timezone, instances });
  } catch (error) { return json({ error: safeMessage(error) }, 500); }
}

export default {
  async fetch(request, env) { return handleRequest(request, env); },
  async scheduled(controller, env) { await runScheduled(env, controller.scheduledTime); },
} satisfies ExportedHandler<Env>;
