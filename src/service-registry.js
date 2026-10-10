import { randomUUID } from 'node:crypto';
import { MAX_PAGE, PAGE_SIZE, SERVICES, SERVICE_DEFINITIONS } from './config.js';
import { missingServiceEnv } from './env.js';
import { getRandomGeo } from './geo.js';
import { parseBoundedInt } from './http.js';
import { pingSupabase, querySupabase, cleanSupabase } from './services/supabase.js';
import { pingOracle, queryOracle, cleanOracle } from './services/oracle.js';

const ADAPTERS = {
  supabase: env => ({
    ping: geo => pingSupabase(env, geo),
    query: page => querySupabase(env, page),
    clean: action => cleanSupabase(env, action)
  }),
  oracle: (env, definition) => {
    // Oracle definitions list connection fields in URL, username, password order.
    const [url, user, password] = definition.required.map(key => env[key]);
    return {
      ping: geo => pingOracle(url, user, password, geo),
      query: page => queryOracle(url, user, password, page),
      clean: action => cleanOracle(url, user, password, action)
    };
  },
  native: (_env, _definition, service, native) => ({
    async ping(geo, requestId) {
      const result = await native.call({ service, operation: 'ping', request_id: requestId, geo });
      return result.ok === true && result.committed === true && result.request_id === requestId;
    },
    async query(page) {
      const result = await native.call({ service, operation: 'query', page, limit: PAGE_SIZE });
      return { rows: [], count: 0, page, limit: PAGE_SIZE, ...result,
        totalPages: Math.max(1, Math.ceil((result.count || 0) / PAGE_SIZE)) };
    }
  })
};

const failure = (env, service) => ({
  ok: false, error: 'configuration_error', missing: missingServiceEnv(env, service),
  rows: [], count: 0, page: 1, limit: PAGE_SIZE, totalPages: 1
});

export function makeBackends(env, native) {
  const cache = new Map();
  return Object.fromEntries(SERVICES.map(service => {
    const definition = SERVICE_DEFINITIONS[service];
    const adapter = ADAPTERS[definition.adapter](env, definition, service, native);
    const invalidate = () => {
      for (const key of cache.keys()) if (key.startsWith(service + ':')) cache.delete(key);
    };
    return [service, {
      async ping(geo = getRandomGeo(), requestId = randomUUID()) {
        if (missingServiceEnv(env, service).length) return false;
        const ok = await adapter.ping(geo, requestId);
        invalidate();
        return ok;
      },
      async query(value) {
        if (missingServiceEnv(env, service).length) return failure(env, service);
        const page = parseBoundedInt(value, 1, 1, MAX_PAGE);
        const key = `${service}:${page}`;
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) return hit.promise;
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        const entry = { expires: Date.now() + 60_000 };
        entry.promise = adapter.query(page).catch(() => ({ ok: false, error: 'database_error', rows: [], count: 0, page, limit: PAGE_SIZE, totalPages: 1 }))
          .then(result => {
            if (!result.ok && cache.get(key) === entry) cache.delete(key);
            return result;
          });
        cache.set(key, entry);
        return entry.promise;
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
