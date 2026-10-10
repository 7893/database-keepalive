import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, scheduled } from '../../src/http/handler.js';
import { makeBackends } from '../../src/db/registry.js';
import { SERVICES } from '../../src/config/services.js';
import { FULL_ENV } from '../helpers.js';

const env = { SCHEDULER_TOKEN: 'scheduler-test-token', TRIGGER_SECRET: 'admin-test-token' };
const req = (path, headers = {}, method = 'GET') => new Request('https://keepalive.test' + path, { headers, method });
test('all write and diagnostic routes reject anonymous and wrong-purpose credentials', async () => {
  for (const path of ['/trigger', '/admin/clean?action=delete', '/api/clean?action=repair', '/debug', '/internal/checkin']) {
    const method = path === '/debug' ? 'GET' : 'POST';
    assert.equal((await handle(req(path, {}, method), env)).status, 401);
  }
  assert.equal((await handle(req('/internal/checkin', {'x-keepalive-scheduler':env.TRIGGER_SECRET}, 'POST'), env)).status,401);
  assert.equal((await handle(req('/trigger', {authorization:'Bearer '+env.SCHEDULER_TOKEN}, 'POST'), env)).status,401);
  assert.equal((await handle(req('/internal/checkin', { authorization: 'Bearer ' }), {})).status,401);
});
test('anonymous public API uses unified backend and masks IP', async () => {
  const backends = { db2: { query: async () => ({ok:true,rows:[{ip:'1.2.3.4'}],count:1}) } };
  const response = await handle(req('/api/data?service=db2'), {...env, backends});
  assert.equal(response.status,200);
  assert.equal((await response.json()).rows[0].ip,'1.2.3.xxx');
});
test('manual trigger uses the same backend and requires admin authorization', async () => {
  let calls=0;
  const e={...FULL_ENV,...env,backends:{mysql_jp:{ping:async()=>{calls++;return true;}}}};
  assert.equal((await handle(req('/trigger?target=mysql_jp',{},'POST'),e)).status,401);
  const response=await handle(req('/trigger?target=mysql_jp',{authorization:'Bearer '+env.TRIGGER_SECRET},'POST'),e);
  assert.equal(response.status,200); assert.equal(calls,1);
});
test('scheduled retries only failed services and preserves idempotency payload',async()=>{
  const calls={};const backends=Object.fromEntries(SERVICES.map(s=>[s,{ping:async(geo,id)=>{
    (calls[s] ||= []).push({geo,id});return s!=='db2'||calls[s].length>1;
  }}]));
  assert.equal((await scheduled({...env,backends},'schedule-1',async()=>{})).status,200);
  assert.equal(calls.db2.length,2);assert.deepEqual(calls.db2[0],calls.db2[1]);
  for(const s of SERVICES.filter(s=>s!=='db2'))assert.equal(calls[s].length,1);
});
test('native queries coalesce and successful writes invalidate cache',async()=>{
  let queries=0;
  const native={call:async d=>d.operation==='query'?(queries++,{ok:true,rows:[],count:0}):{ok:true,committed:true,request_id:d.request_id}};
  const b=makeBackends(FULL_ENV,native).db2;
  await Promise.all([b.query(1),b.query(1)]);assert.equal(queries,1);
  await b.ping({});await b.query(1);assert.equal(queries,2);
});
test('anonymous page is rendered without database credentials in HTML', async () => {
  const backends = Object.fromEntries(SERVICES.map(s => [s, {query:async()=>({ok:true,rows:[],count:0,page:1,totalPages:1})}]));
  const response = await handle(req('/'), {...env,backends});
  assert.equal(response.status,200);
  const html = await response.text();
  assert.ok(html.includes('Supabase'));
  assert.ok(!html.includes(env.TRIGGER_SECRET));
  assert.ok(!html.includes(env.SCHEDULER_TOKEN));
});

test('dedicated scheduler header authenticates only the scheduled endpoint', async () => {
  const backends=Object.fromEntries(SERVICES.map(s=>[s,{ping:async()=>true}]));
  const r=await handle(req('/internal/checkin',{'x-keepalive-scheduler':env.SCHEDULER_TOKEN},'POST'),{...env,backends});
  assert.equal(r.status,200);
  assert.equal((await handle(req('/trigger',{'x-keepalive-scheduler':env.SCHEDULER_TOKEN},'POST'),env)).status,401);
});
