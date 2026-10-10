import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SERVICES, GLOBAL_POPS } from '../src/config.js';
import { serviceEnvNames } from '../src/env.js';
import { pingSupabase } from '../src/services/supabase.js';
import { pingMySQL } from '../src/services/mysql.js';
import { fetchWithTimeout } from '../src/http.js';

// Cloud Run retries share the execution name. Keep bridge request IDs and
// simulated display metadata stable across those retries.
export function metadata(execution, service) {
  const hash = createHash('sha256').update(`${execution}:${service}`).digest();
  const hex = hash.toString('hex');
  const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const pop = GLOBAL_POPS[hash.readUInt32BE(0) % GLOBAL_POPS.length];
  const subnet = pop.subnets?.[hash[4] % pop.subnets.length] || '104.28.0';
  return { requestId, geo: { colo: pop.colo, country: pop.country,
    city: pop.city, region: pop.region, ip: `${subnet}.${2 + hash[5] % 252}` } };
}

export function validate(env) {
  const names = SERVICES.flatMap(s => s === 'db2'
    ? ['DB2_HOST','DB2_PORT','DB2_DATABASE','DB2_USER','DB2_PASSWORD','DB2_JDBC_JAR','DB2_CA_FILE']
    : serviceEnvNames(s));
  const missing = names.filter(n => !env[n]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
}

export function sqlSucceeded(body) {
  return Array.isArray(body?.items) && body.items.length > 0
    && body.items.every(item => !item.errorDetails && !item.errorCode
      && !item.error && item.statementId !== undefined);
}

export async function oracle(env, service, geo) {
  const prefix = service === 'adb_jp' ? 'OCI_ADB_JP' : 'OCI_ADB_US';
  const authorization = `Basic ${Buffer.from(`${env[`${prefix}_USER`]}:${env[`${prefix}_PASS`]}`).toString('base64')}`;
  const field = v => String(v || '').replaceAll("'", "''");
  const statementText = `INSERT INTO keepalive_log (status,colo,country,city,region,ip) VALUES ('SUCCESS',${['colo','country','city','region','ip'].map(k => `'${field(geo[k])}'`).join(',')})`;
  const response = await fetchWithTimeout(`${env[`${prefix}_URL`]}/_/sql`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ statementText })
  });
  if (!response.ok) return false;
  const body = await response.json();
  return sqlSucceeded(body) && body.items.some(item => item.statementType === 'dml' && item.result === 1);
}

function db2(env, requestId, geo) {
  return new Promise(resolve => {
    const child = spawn(env.DB2_PYTHON || '/opt/venv/bin/python', ['-B', 'job/db2_checkin.py'], {
      env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000
    });
    let output = '';
    child.stdout.on('data', chunk => { if (output.length < 8192) output += chunk; });
    // Driver exceptions can contain connection details. Never forward raw stderr.
    child.stderr.resume();
    child.on('error', () => resolve(false));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      try { const result = JSON.parse(output); resolve(code === 0 && result.committed === true); }
      catch { resolve(false); }
    });
    child.stdin.end(JSON.stringify({ request_id: requestId, geo }));
  });
}

export async function run(env, execution, execute = async (service, meta) => {
  if (service === 'supabase') return pingSupabase(env, meta.geo);
  if (service.startsWith('adb_')) return oracle(env, service, meta.geo);
  if (service === 'mysql_jp') return pingMySQL(env, service, meta.geo, meta.requestId);
  return db2(env, meta.requestId, meta.geo);
}) {
  validate(env);
  const results = await Promise.all(SERVICES.map(async service => {
    let ok = false;
    try { ok = await execute(service, metadata(execution, service)); } catch {}
    console.log(JSON.stringify({ service, ok, execution }));
    return ok;
  }));
  return results.every(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    process.exitCode = await run(env, process.env.CLOUD_RUN_EXECUTION || randomUUID()) ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ event: 'job_configuration_error' }));
    process.exitCode = 1;
  }
}
