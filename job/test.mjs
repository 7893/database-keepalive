import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata, run, sqlSucceeded } from './run.mjs';
import { SERVICES } from '../src/config.js';
import { serviceEnvNames } from '../src/env.js';

const env = Object.fromEntries([...SERVICES.flatMap(s => serviceEnvNames(s)),
  'DB2_HOST','DB2_PORT','DB2_DATABASE','DB2_USER','DB2_PASSWORD','DB2_JDBC_JAR','DB2_CA_FILE'].map(k => [k, 'test']));
test('same execution retries preserve request ID and payload', () => {
  assert.deepEqual(metadata('run-1','db2'), metadata('run-1','db2'));
  assert.notEqual(metadata('run-1','db2').requestId, metadata('run-2','db2').requestId);
});
test('SQL error within HTTP 200 must fail', () => {
  assert.equal(sqlSucceeded({items:[{statementId:1,errorDetails:'ORA-00942'}]}),false);
  assert.equal(sqlSucceeded({items:[{statementId:1,statementType:'dml',result:1}]}),true);
  assert.equal(sqlSucceeded({items:[]}),false);
});
test('a failed database fails the execution without skipping other databases', async () => {
  const seen = [];
  assert.equal(await run(env, 'test', async s => {seen.push(s); if(s === 'db2') throw Error('sensitive'); return true;}),false);
  assert.deepEqual(seen, SERVICES);
});
test('missing configuration prevents all database writes', async () => {
  let called = false;
  await assert.rejects(run({}, 'test', async () => {called = true;}), /Missing configuration/);
  assert.equal(called,false);
});
