import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata } from '../../src/geo/metadata.js';
import { pingOracle } from '../../src/db/oracle.js';
import { withMockedFetch } from '../helpers.js';

test('retry metadata is deterministic and distinct across executions',()=>{
  assert.deepEqual(metadata('first','db2'),metadata('first','db2'));
  assert.notEqual(metadata('first','db2').requestId,metadata('second','db2').requestId);
});
test('Oracle requires a committed matching row, even after SQL success', async () => {
  const id = '11111111-1111-4111-a111-111111111111';
  for (const [rows, expected] of [
    [[], false], [[{request_id:id,status:'FAILED'}], false],
    [[{request_id:'other',status:'SUCCESS'}], false],
    [[{request_id:id,status:'SUCCESS'}], true]
  ]) await withMockedFetch(async (_url, init) => {
    const sql = JSON.parse(init.body).statementText;
    return Response.json({items:[sql.startsWith('SELECT')
      ? {statementId:1,resultSet:{items:rows}}
      : {statementId:1,statementType:'plsql'}]});
  }, async () => assert.equal(await pingOracle('https://oracle.test','user','pass',{},id), expected));
});
