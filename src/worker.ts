import { parseConfig, safeMessage } from './config.ts';
import { openDriver, type Driver } from './db.ts';
import type { DriverFactory } from './execute.ts';
import { SCHEDULER_NAME } from './schedule.ts';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
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

export async function handleRequest(request: Request, env: Env, factory: DriverFactory = openDriver,
  readNextTimes: () => Promise<Record<string, string>> = () => env.SCHEDULER.getByName(SCHEDULER_NAME).nextTimes()): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (path !== '/api/status') return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const settings = parseConfig(env.CONFIG);
    const configs = settings.databases;
    const nextTimes = await readNextTimes();
    const instances = await mapLimited(configs, async config => {
      const base = { id: config.id, name: config.name, type: config.type, region: config.region, next_time: nextTimes[config.id] ?? null };
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
  async scheduled(_controller, env) { await env.SCHEDULER.getByName(SCHEDULER_NAME).wake(); },
} satisfies ExportedHandler<Env>;
