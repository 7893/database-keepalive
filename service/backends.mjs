import { randomUUID } from 'node:crypto';
import { SERVICES, PAGE_SIZE, MAX_PAGE } from '../src/config.js';
import { pingSupabase, querySupabase } from '../src/services/supabase.js';
import { queryOracle } from '../src/services/oracle.js';
import { oracle } from '../job/run.mjs';
import { parseBoundedInt } from '../src/http.js';

export function makeBackends(env, native) {
  const cache = new Map();
  const backends = {};
  for (const service of SERVICES) {
    const prefix = service === 'adb_us' ? 'OCI_ADB_US' : 'OCI_ADB_JP';
    const query = async page => {
      if (service === 'supabase') return querySupabase(env, page);
      if (service.startsWith('adb_')) return queryOracle(env[`${prefix}_URL`], env[`${prefix}_USER`], env[`${prefix}_PASS`], page);
      const result = await native.call({ service, operation: 'query', page, limit: PAGE_SIZE });
      return { rows: [], count: 0, page, limit: PAGE_SIZE, ...result,
        totalPages: Math.max(1, Math.ceil((result.count || 0) / PAGE_SIZE)) };
    };
    backends[service] = {
      async ping(geo, requestId = randomUUID()) {
        let ok;
        if (service === 'supabase') ok = await pingSupabase(env, geo);
        else if (service.startsWith('adb_')) ok = await oracle(env, service, geo);
        else {
          const result = await native.call({ service, operation: 'ping', request_id: requestId, geo });
          ok = result.ok === true && result.committed === true && result.request_id === requestId;
        }
        for (const key of cache.keys()) if (key.startsWith(service + ':')) cache.delete(key);
        return ok;
      },
      async query(value) {
        const page = parseBoundedInt(value, 1, 1, MAX_PAGE);
        const key = `${service}:${page}`;
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) return hit.promise;
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        const entry = { expires: Date.now() + 60_000 };
        entry.promise = query(page).catch(() => ({ ok: false, error: 'database_error', rows: [], count: 0, page, limit: PAGE_SIZE, totalPages: 1 }))
          .then(result => {
            if (!result.ok && cache.get(key) === entry) cache.delete(key);
            return result;
          });
        cache.set(key, entry);
        return entry.promise;
      }
    };
  }
  return backends;
}
