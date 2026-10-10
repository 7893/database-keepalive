import { randomUUID } from 'node:crypto';
import { MAX_PAGE, PAGE_SIZE } from '../config/constants.js';
import { SERVICES, SERVICE_DEFINITIONS } from '../config/services.js';
import { missingServiceEnv } from '../config/env.js';
import { getRandomGeo } from '../geo/resolve.js';
import { parseBoundedInt } from '../shared/values.js';
import { createAdapter } from './adapters.js';
import { readCache } from './cache.js';


const failure = (env, service) => ({
  ok: false, error: 'configuration_error', missing: missingServiceEnv(env, service),
  rows: [], count: 0, page: 1, limit: PAGE_SIZE, totalPages: 1
});

export function makeBackends(env, native) {
  const cache = readCache();
  return Object.fromEntries(SERVICES.map(service => {
    const adapter = createAdapter(env, service, native);
    return [service, {
      async ping(geo = getRandomGeo(), requestId = randomUUID()) {
        if (missingServiceEnv(env, service).length) return false;
        const ok = await adapter.ping(geo, requestId);
        cache.invalidate(service);
        return ok;
      },
      async query(value) {
        if (missingServiceEnv(env, service).length) return failure(env, service);
        const page = parseBoundedInt(value, 1, 1, MAX_PAGE);
        try {
          return await cache.read(service, page, () => adapter.query(page));
        } catch {
          return { ok: false, error: 'database_error', rows: [], count: 0, page, limit: PAGE_SIZE, totalPages: 1 };
        }
      },
      ...(adapter.clean ? { clean: adapter.clean } : {})
    }];
  }));
}

export async function runService(service, env, geo, requestId) {
  return env.backends?.[service]?.ping(geo, requestId) ?? false;
}

export async function queryService(env, service, page) {
  return env.backends?.[service]?.query(page) ?? failure(env, service);
}

export async function getStats(env, pages = {}) {
  return Object.fromEntries(await Promise.all(SERVICES.map(async service => {
    const value = pages[service] || pages[SERVICE_DEFINITIONS[service].pageAlias] || pages.page;
    return [service, await queryService(env, service, parseBoundedInt(value, 1, 1, MAX_PAGE))];
  })));
}

export async function cleanServices(env, action) {
  const targets = SERVICES.filter(service => ['supabase', 'oracle'].includes(SERVICE_DEFINITIONS[service].adapter));
  const missing = [...new Set(targets.flatMap(service => missingServiceEnv(env, service)))];
  if (missing.length) return { success: false, error: 'configuration_error', missing };
  const results = Object.fromEntries(await Promise.all(targets.map(async service => [
    service, await env.backends[service].clean(action)
  ])));
  return { success: Object.values(results).every(result => result.ok), results };
}
