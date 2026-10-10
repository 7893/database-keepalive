import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../src/http/router.js';
import { makeBackends } from '../../src/db/registry.js';
import { missingServiceEnv } from '../../src/config/env.js';
import { FULL_ENV, configured, request, authorized } from '../helpers.js';

test('backends do not bypass missing configuration or contact an unconfigured database', async () => {
  const raw = { ...FULL_ENV };
  delete raw.MYSQL_PASSWORD;
  const env = configured(raw, { call: async () => assert.fail('Unconfigured database contacted') });
  assert.deepEqual(missingServiceEnv(env, 'mysql_jp'), ['MYSQL_PASSWORD']);
  const response = await handleRequest(request('/api/data?service=mysql_jp'), env);
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).missing, ['MYSQL_PASSWORD']);
  assert.equal((await handleRequest(request('/trigger?target=mysql_jp', authorized()), env)).status, 503);
  assert.equal(await env.backends.mysql_jp.ping({}), false);
});

test('query failures are not cached and cache entries remain isolated by service and page', async () => {
  const calls = []; let fail = true;
  const backends = makeBackends(FULL_ENV, { call: async data => {
    calls.push([data.service, data.page]);
    if (fail) return { ok: false, error: 'database_error' };
    return { ok: true, rows: [], count: 21 };
  } });
  assert.equal((await backends.db2.query(1)).ok, false);
  fail = false;
  assert.equal((await backends.db2.query(1)).ok, true);
  await backends.db2.query(1);
  await backends.db2.query(2);
  await backends.mysql_jp.query(1);
  assert.deepEqual(calls, [['db2', 1], ['db2', 1], ['db2', 2], ['mysql_jp', 1]]);
});
