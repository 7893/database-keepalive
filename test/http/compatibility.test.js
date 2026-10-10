import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../src/http/router.js';
import { FULL_ENV, configured, request, authorized, withMockedFetch } from '../helpers.js';

const services = ['supabase', 'adb_us', 'adb_jp', 'db2', 'mysql_jp'];

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

test('both maintenance URLs preserve repair/delete targets and upstream operations', async () => {
  const calls = [];
  await withMockedFetch(async (url, init) => { calls.push([String(url), init.method]); return new Response('', { status: 200 }); }, async () => {
    for (const [path, action, method] of [['/admin/clean', 'repair', 'POST'], ['/api/clean', 'delete', 'DELETE']]) {
      calls.length = 0;
      const response = await handleRequest(request(path + '?action=' + action, authorized(method)), configured(FULL_ENV));
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys((await response.json()).results), ['supabase', 'adb_us', 'adb_jp']);
      assert.equal(calls.length, 4);
      assert.equal(calls.filter(([url, verb]) => new URL(url).origin === 'https://supabase.test' && verb === (action === 'repair' ? 'PATCH' : 'DELETE')).length, 2);
      assert.equal(calls.filter(([url, verb]) => url.endsWith('/_/sql') && verb === 'POST').length, 2);
    }
  });
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
