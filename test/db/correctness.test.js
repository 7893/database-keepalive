import test from 'node:test';
import assert from 'node:assert/strict';
import { pingOracle, queryOracle, cleanOracle } from '../../src/db/oracle.js';
import { pingSupabase } from '../../src/db/supabase.js';
import { makeBackends } from '../../src/db/registry.js';
import { FULL_ENV, withMockedFetch } from '../helpers.js';

const ID = '11111111-1111-4111-a111-111111111111';
const GEO = { colo:'NRT', country:'JP', city:'Tokyo', region:'Kanto', ip:'203.0.113.2' };
const receipt = { ...GEO, request_id:ID, status:'SUCCESS' };

test('Oracle rejects SQL errors and malformed results inside HTTP 200', async () => {
  for (const body of [{}, {items:[]}, {items:[{statementId:1,errorDetails:'ORA-00942'}]},
    {items:[{statementId:1,resultSet:{items:[]}}]}]) {
    await withMockedFetch(async () => Response.json(body), async () => {
      assert.equal((await queryOracle('https://oracle.test','u','p')).ok, false);
    });
  }
  await withMockedFetch(async () => Response.json({items:[{statementId:1,errorCode:942}]}), async () => {
    assert.equal(await pingOracle('https://oracle.test','u','p',GEO,ID), false);
    for (const action of ['repair','delete'])
      assert.equal((await cleanOracle('https://oracle.test','u','p',action)).ok, false);
  });
});

test('Supabase retry uses its unique key and requires a matching committed receipt', async () => {
  for (const [rows, expected] of [[[receipt],true], [[],false],
    [[{...receipt,city:'Osaka'}],false], [[{...receipt,request_id:'other'}],false]]) {
    let writes = 0;
    await withMockedFetch(async (url, init) => {
      if (init.method === 'POST') {
        writes++;
        assert.equal(new URL(url).searchParams.get('on_conflict'), 'request_id');
        assert.match(init.headers.Prefer, /resolution=ignore-duplicates/);
        assert.equal(JSON.parse(init.body).request_id, ID);
        return new Response(null, {status:201});
      }
      return Response.json(rows);
    }, async () => {
      assert.equal(await pingSupabase(FULL_ENV,GEO,ID),expected);
      assert.equal(await pingSupabase(FULL_ENV,GEO,ID),expected);
    });
    assert.equal(writes,2);
  }
});

test('Oracle reuses the request key and fails closed on mismatched duplicate payloads', async () => {
  await withMockedFetch(async (_url, init) => {
    const sql = JSON.parse(init.body).statementText;
    assert.ok(sql.includes(ID));
    if (sql.startsWith('SELECT')) return Response.json({items:[{statementId:1,
      resultSet:{items:[{...receipt,city:'Osaka'}]}}]});
    assert.match(sql, /EXCEPTION WHEN DUP_VAL_ON_INDEX/);
    return Response.json({items:[{statementId:1,statementType:'plsql'}]});
  }, async () => assert.equal(await pingOracle('https://oracle.test','u','p',GEO,ID),false));
});

test('maintenance invalidates cached rows even after partially failed operations', async () => {
  for (const action of ['repair','delete']) {
    let queries = 0;
    await withMockedFetch(async (_url, init) => {
      if (init.method) return new Response(null,{status:500});
      queries++;
      return Response.json([], {headers:{'content-range':'*/0'}});
    }, async () => {
      const backend = makeBackends(FULL_ENV,{}).supabase;
      await backend.query(1); await backend.query(1);
      assert.equal(queries,1);
      assert.equal((await backend.clean(action)).ok,false);
      await backend.query(1);
      assert.equal(queries,2);
    });
  }
});
