import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { CLIENT_SCRIPT } from '../src/ui/client-script.js';
import { renderServiceTable } from '../src/ui/components.js';
import { handleRequest } from '../src/router.js';
import { makeBackends } from '../src/service-registry.js';
import { missingServiceEnv } from '../src/env.js';
import { runtimeConfig, tunnelAddress } from '../service/config.mjs';
import { FULL_ENV, configured, request, authorized, withMockedFetch } from './helpers.js';

const services = ['supabase', 'adb_us', 'adb_jp', 'db2', 'mysql_jp'];
const compact = html => html.replace(/>\s+</g, '><').trim();
const rows = [
  { status: 'SUCCESS', ping_time: '2026-10-10T20:59:01Z', colo: 'SIN', country: 'US', city: 'Edge', ip: '203.0.113.xxx' },
  { status: 'FAILED', ping_time: '<time>', colo: 'XYZ', country: 'XX', city: '<script>bad</script>', ip: '"<&' },
  { status: 'SUCCESS' }
];

test('browser pagination preserves server-rendered rows, locations, dates, escaping and controls', async () => {
  const elements = {
    'tbody-supabase': { classList: { add() {}, remove() {} } },
    'footer-supabase': {}, 'badge-supabase': {}
  };
  const context = {
    document: { addEventListener() {}, getElementById: id => elements[id] },
    window: { location: { search: '' } },
    fetch: async url => {
      assert.equal(url, '/api/data?service=supabase&page=5');
      return Response.json({ ok: true, rows, count: 101, page: 5, totalPages: 11 });
    },
    alert: message => assert.fail(message), console
  };
  await runInNewContext(CLIENT_SCRIPT + '\ngoToPage("supabase", 5)', context);
  const html = renderServiceTable('supabase', 'Supabase', { rows, count: 101, page: 5, totalPages: 11 });
  assert.equal(compact(elements['tbody-supabase'].innerHTML), compact(html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)[1]));
  assert.equal(compact(elements['footer-supabase'].innerHTML), compact(html.match(/id="footer-supabase">([\s\S]*)<\/div>\s*<\/div>/)[1]));
  assert.match(html, /🇸🇬 Singapore \(SIN\)/);
  assert.match(html, /10-11 04:59:01/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-page="4"/);
  assert.match(html, /data-page="6"/);
  assert.match(html, /page-ellipsis/);
  assert.equal(elements['badge-supabase'].textContent, '101 pings');
});

test('empty rows, failed reads and first/last-page controls keep their existing display', () => {
  const browser = runInNewContext(CLIENT_SCRIPT + '\n({ renderRows, renderPagination })', {
    document: { addEventListener() {} }, window: { location: { search: '' } }
  });
  assert.match(browser.renderRows(null), /No records yet/);
  assert.equal(browser.renderPagination(1, 1, 0), '');
  const first = browser.renderPagination(1, 10, 100);
  const last = browser.renderPagination(10, 10, 100);
  assert.match(first, /class="page-btn disabled"[^>]*>上一页/);
  assert.match(last, /class="page-btn disabled"[^>]*>下一页/);
  assert.match(renderServiceTable('db2', 'Db2', { ok: false, error: 'database_error' }), /Unable to load data/);
});

test('service execution order, page order and pagination aliases remain unchanged', async () => {
  const calls = [];
  const env = { ...FULL_ENV, backends: Object.fromEntries(services.map(service => [service, {
    query: async page => { calls.push([service, page]); return { ok: true, rows: [], count: 0, page, totalPages: 1 }; }
  }])) };
  const response = await handleRequest(request('/?supabase_p=2&sb_p=9&us_p=3&adb_jp_p=4&db2_p=5&mysql_jp_p=6&page=7'), env);
  const html = await response.text();
  assert.deepEqual(calls, [['supabase', 2], ['adb_us', 3], ['adb_jp', 4], ['db2', 5], ['mysql_jp', 6]]);
  assert.deepEqual([...html.matchAll(/class="card" id="card-([^"]+)"/g)].map(m => m[1]), ['supabase', 'db2', 'adb_us', 'mysql_jp', 'adb_jp']);
  calls.length = 0;
  const debug = await handleRequest(request('/debug?supabase=8&sb_p=2&us_p=3&jp_p=4&db2_p=5&mysql_jp_p=6', authorized('GET')), env);
  assert.deepEqual(Object.keys(await debug.json()), services);
  assert.deepEqual(calls, [['supabase', 8], ['adb_us', 3], ['adb_jp', 4], ['db2', 5], ['mysql_jp', 6]]);
});

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

test('startup checks all credentials without exposing their values and shares the configured tunnel address', () => {
  const env = { ...FULL_ENV, PUBLIC_ORIGIN: 'https://keepalive.test', SCHEDULER_TOKEN: 'test-scheduler-token',
    MYSQL_CA_PEM: 'test-ca', TUNNEL_SERVICE_HOSTNAME: 'tunnel.test',
    TUNNEL_SERVICE_TOKEN_ID: 'test-client-id', TUNNEL_SERVICE_TOKEN_SECRET: 'test-client-secret' };
  assert.equal(tunnelAddress(runtimeConfig(env)), '127.0.0.1:13306');
  const changed = runtimeConfig({ ...env, MYSQL_HOST: '::1', MYSQL_PORT: '14406' });
  assert.equal(tunnelAddress(changed), '[::1]:14406');
  assert.equal(changed.MYSQL_PORT, '14406');
  for (const port of ['0', '-1', '65536', 'abc', '13306junk'])
    assert.throws(() => runtimeConfig({ ...env, MYSQL_PORT: port }), /Invalid configuration: MYSQL_PORT/);
  const missing = { ...env }; delete missing.OCI_ADB_JP_PASS; delete missing.DB2_PASSWORD;
  assert.throws(() => runtimeConfig(missing), error => {
    assert.match(error.message, /OCI_ADB_JP_PASS/); assert.match(error.message, /DB2_PASSWORD/);
    assert.doesNotMatch(error.message, /test-pass|test-client-secret/); return true;
  });
});

test('both maintenance URLs preserve repair/delete targets and upstream operations', async () => {
  const calls = [];
  await withMockedFetch(async (url, init) => { calls.push([String(url), init.method]); return new Response('', { status: 200 }); }, async () => {
    for (const [path, action, method] of [['/admin/clean', 'repair', 'POST'], ['/api/clean', 'delete', 'DELETE']]) {
      calls.length = 0;
      const response = await handleRequest(request(path + '?action=' + action, authorized(method)), configured(FULL_ENV));
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys((await response.json()).results), ['supabase', 'adb_us', 'adb_jp']);
      assert.equal(calls.length, 4);
      assert.equal(calls.filter(([url, verb]) => url.startsWith('https://supabase.test') && verb === (action === 'repair' ? 'PATCH' : 'DELETE')).length, 2);
      assert.equal(calls.filter(([url, verb]) => url.endsWith('/_/sql') && verb === 'POST').length, 2);
    }
  });
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

test('all existing geographic modes, random alias and manual redirect remain available', async () => {
  const calls = [];
  const env = { ...FULL_ENV, backends: Object.fromEntries(services.map(service => [service, {
    ping: async geo => { calls.push([service, geo]); return true; }
  }])) };
  let traces = 0;
  await withMockedFetch(async url => {
    assert.equal(url, 'https://1.1.1.1/cdn-cgi/trace'); traces++;
    return new Response('ip=198.51.100.1\ncolo=SIN\nloc=SG\n');
  }, async () => {
    for (const mode of ['simulated', 'random', 'real', 'client']) {
      calls.length = 0;
      const req = request('/trigger?mode=' + mode, authorized());
      req.cf = { colo: 'NRT', country: 'JP', city: 'Tokyo', region: 'Kanto' };
      req.headers.set('cf-connecting-ip', '203.0.113.5');
      const response = await handleRequest(req, env);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys((await response.json()).results), services);
      assert.deepEqual(calls.map(([service]) => service), services);
      if (mode === 'simulated' || mode === 'random') assert.equal(new Set(calls.map(([, geo]) => geo.colo)).size, 5);
      if (mode === 'real') assert.ok(calls.every(([, geo]) => geo.colo === 'SIN' && geo.ip === '198.51.100.1'));
      if (mode === 'client') assert.ok(calls.every(([, geo]) => geo.city === 'Tokyo' && geo.ip === '203.0.113.5'));
    }
    assert.equal(traces, 1);
    const req = request('/trigger?target=db2', authorized());
    req.headers.set('accept', 'text/html');
    const response = await handleRequest(req, env);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://keepalive.test');
  });
});
