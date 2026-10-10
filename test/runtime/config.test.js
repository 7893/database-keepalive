import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, tunnelAddress } from '../../src/runtime/config.js';
import { FULL_ENV } from '../helpers.js';

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
