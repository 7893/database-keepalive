import test from 'node:test';
import assert from 'node:assert/strict';
import { uniformInteger } from '../../src/geo/random.js';
import { getDistinctRandomGeos } from '../../src/geo/resolve.js';
import { metadata } from '../../src/geo/metadata.js';
import { SERVICES } from '../../src/config/services.js';
import { handleRequest } from '../../src/http/router.js';
import { FULL_ENV, request, authorized, withMockedFetch } from '../helpers.js';

test('integer sampling rejects the biased remainder and reaches both endpoints', () => {
  const range = 252;
  const ceiling = Math.floor(2 ** 32 / range) * range;
  const words = [2 ** 32 - 1, ceiling, 0, 251];
  assert.equal(uniformInteger(() => words.shift(),2,253),2);
  assert.equal(words.length,1);
  assert.equal(uniformInteger(() => words.shift(),2,253),253);
  const counts = Array(range).fill(0);
  for (let word = 0; word < range * 2; word++) counts[uniformInteger(() => word,0,251)]++;
  assert.ok(counts.every(count => count === 2));
});

test('scheduled and manual rounds use distinct nodes; retries retain IDs and geography', () => {
  for (const execution of ['job:first','job:second','job:third']) {
    const round = SERVICES.map(service => metadata(execution, service));
    assert.equal(new Set(round.map(value => value.geo.colo)).size,SERVICES.length);
    assert.equal(new Set(round.map(value => value.requestId)).size,SERVICES.length);
    assert.deepEqual(round,SERVICES.map(service => metadata(execution,service)));
    assert.ok(round.every(({geo}) => {const last = +geo.ip.split('.').at(-1); return last >= 2 && last <= 253;}));
  }
  assert.equal(new Set(getDistinctRandomGeos(40).map(geo=>geo.colo)).size,40);
  assert.throws(()=>getDistinctRandomGeos(41),RangeError);
});

test('unavailable or malformed real/client location never causes simulated writes', async () => {
  let writes = 0;
  const env = {...FULL_ENV,backends:Object.fromEntries(SERVICES.map(service =>
    [service,{ping:async()=>{writes++;return true;}}]))};
  for (const body of ['','ip=bad\ncolo=SIN\nloc=SG','ip=203.0.113.1\ncolo=SIN']) {
    await withMockedFetch(async()=>new Response(body),async()=>{
      const res=await handleRequest(request('/trigger?mode=real',authorized()),env);
      assert.equal(res.status,502);
      assert.equal((await res.json()).error,'real_geo_unavailable');
    });
  }
  const req=request('/trigger?mode=client',authorized());
  req.headers.set('cf-connecting-ip','203.0.113.1'); // An untrusted header cannot supply geography.
  const res=await handleRequest(req,env);
  assert.equal(res.status,502);
  assert.equal((await res.json()).error,'client_geo_unavailable');
  assert.equal(writes,0);
});
