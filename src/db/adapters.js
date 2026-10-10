import { PAGE_SIZE } from '../config/constants.js';
import { SERVICE_DEFINITIONS } from '../config/services.js';
import { pingSupabase, querySupabase, cleanSupabase } from './supabase.js';
import { pingOracle, queryOracle, cleanOracle } from './oracle.js';

const ADAPTERS = {
  supabase: env => ({
    ping: (geo, id) => pingSupabase(env, geo, id),
    query: page => querySupabase(env, page),
    clean: action => cleanSupabase(env, action)
  }),
  oracle: (env, definition) => {
    // Oracle definitions list connection fields in URL, username, password order.
    const [url, user, password] = definition.required.map(key => env[key]);
    return {
      ping: (geo, id) => pingOracle(url, user, password, geo, id),
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

export function createAdapter(env, service, native) {
  const definition = SERVICE_DEFINITIONS[service];
  return ADAPTERS[definition.adapter](env, definition, service, native);
}
