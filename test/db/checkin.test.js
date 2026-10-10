import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata } from '../../src/geo/metadata.js';
import { pingOracle } from '../../src/db/oracle.js';
import { withMockedFetch } from '../helpers.js';

test('retry metadata is deterministic and distinct across executions',()=>{
  assert.deepEqual(metadata('first','db2'),metadata('first','db2'));
  assert.notEqual(metadata('first','db2').requestId,metadata('second','db2').requestId);
});
test('Oracle accepts only a confirmed single-row insert, not HTTP success alone',async()=>{
  for(const [item,expected] of [
    [{statementId:1,errorDetails:'ORA-00942'},false],
    [{statementId:1,statementType:'dml',result:0},false],
    [{statementId:1,statementType:'dml',result:1},true]
  ])await withMockedFetch(async()=>Response.json({items:[item]}),async()=>{
    assert.equal(await pingOracle('https://oracle.test','user','pass',{}),expected);
  });
});
