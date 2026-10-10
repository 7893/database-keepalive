import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../src/http/router.js';
import { FULL_ENV, authorized, request, configured } from '../helpers.js';

const ROW={id:1,status:'SUCCESS',ping_time:'2026-10-10T01:23:00Z',ip:'203.0.113.7'};
test('native MySQL writes and paginated reads preserve authentication and privacy',async()=>{
  const writes=[];
  const env=configured(FULL_ENV,{call:async d=>{
    assert.equal(d.service,'mysql_jp');
    if(d.operation==='ping'){writes.push(d);return {ok:true,committed:true,request_id:d.request_id,row:ROW};}
    assert.equal(d.page,2);return {ok:true,rows:[ROW],count:11,page:2,limit:10};
  }});
  assert.equal((await handleRequest(request('/trigger?target=mysql_jp',{method:'POST'}),env)).status,401);
  assert.equal(writes.length,0);
  assert.equal((await handleRequest(request('/trigger?target=mysql_jp',authorized()),env)).status,200);
  const response=await handleRequest(request('/api/data?service=mysql_jp&page=2'),env);
  assert.equal((await response.json()).rows[0].ip,'203.0.113.xxx');
  assert.equal(writes.length,1);
});
test('Japan MySQL is shown; US business MySQL cannot be queried or triggered',async()=>{
  const html=await (await handleRequest(request('/'),{})).text();
  assert.match(html,/card-mysql_jp/);assert.doesNotMatch(html,/card-mysql_us/);
  const env=configured(FULL_ENV,{call:async()=>{throw Error('must not contact US MySQL');}});
  assert.equal((await handleRequest(request('/trigger?target=mysql_us',authorized()),env)).status,400);
  assert.equal((await handleRequest(request('/api/data?service=mysql_us'),env)).status,400);
});
