import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseDatabases, schedulePolicy, safeMessage, SafeError } from '../src/config.ts';
import { dailyPlan, dueTimes, nextTime, requestId, INTERVAL, RETRY_WINDOW } from '../src/schedule.ts';
import { checkin, Oracle, Supabase, MySQL, type Driver, type Checkin } from '../src/db.ts';
import { handleRequest, runScheduled, type DriverFactory } from '../src/worker.ts';
import type { Connection } from 'mysql2/promise';

const database = { id: 'one', type: 'supabase', url: 'https://example.com', key: 'sb_secret_test', name: 'One', region: '' } as const;
const env = { DATABASES: JSON.stringify([database]), DAILY_MIN: 1, DAILY_MAX: 3, DISPLAY_TIMEZONE: 'Asia/Shanghai' } as Env;
const record: Checkin = { id: '1', ping_time: '2026-10-14T00:00:00.000Z', status: 'SUCCESS' };
function memoryDriver() {
  const rows = new Map<string, Checkin>();
  let inserts = 0, closes = 0;
  const driver: Driver = {
    latest: async () => [...rows.values()],
    find: async id => rows.get(id),
    insert: async id => { inserts++; rows.set(id, record); },
    close: async () => { closes++; },
  };
  return { driver, rows, counts: () => ({ inserts, closes }) };
}

test('configuration rejects duplicate IDs, Db2, insecure URLs and invalid schedule bounds', () => {
  for (const entries of [[database, database], [{ ...database, type: 'db2' }], [{ ...database, url: 'http://example.com' }], [{ ...database, url: 'https://user:password@example.com' }]]) {
    assert.throws(() => parseDatabases(JSON.stringify(entries)), SafeError);
  }
  assert.throws(() => schedulePolicy(0, 3));
  assert.throws(() => schedulePolicy(3, 2));
  assert.throws(() => schedulePolicy(1, 13));
  assert.equal(parseDatabases(JSON.stringify([database]))[0]?.id, 'one');
});

test('plans are deterministic, bounded and aligned; adjacent retry windows never overlap', async () => {
  const day = Date.UTC(2026, 9, 14);
  for (let i = 0; i < 30; i++) {
    const policy = { min: 1, max: 12 };
    const plan = await dailyPlan(`db-${i}`, day, policy);
    assert.deepEqual(plan, await dailyPlan(`db-${i}`, day + 1234, policy));
    assert.ok(plan.length >= 1 && plan.length <= 12);
    for (const [index, time] of plan.entries()) {
      assert.ok(time >= day && time < day + 86_400_000);
      assert.equal(time % INTERVAL, 0);
      if (index > 0) assert.ok(time - plan[index - 1]! >= RETRY_WINDOW);
    }
  }
});

test('missed ticks retry at +5/+10 minutes, expire at +15, and next time crosses midnight', async () => {
  const day = Date.UTC(2026, 9, 14), policy = { min: 1, max: 1 };
  const time = (await dailyPlan('one', day, policy))[0]!;
  for (const offset of [0, INTERVAL, 2 * INTERVAL]) assert.deepEqual(await dueTimes('one', time + offset, policy), [time]);
  assert.deepEqual(await dueTimes('one', time + RETRY_WINDOW, policy), []);
  assert.equal(await nextTime('one', day + 86_400_000 - 1, policy), new Date((await dailyPlan('one', day + 86_400_000, policy))[0]!).toISOString());
});

test('IDs are stable UUIDs and isolate databases and scheduled times', async () => {
  const id = await requestId('scheduled-v1:one:123');
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(id, await requestId('scheduled-v1:one:123'));
  assert.notEqual(id, await requestId('scheduled-v1:two:123'));
  assert.notEqual(id, await requestId('scheduled-v1:one:456'));
});

test('check-in requires a committed receipt and a retry never inserts twice', async () => {
  const memory = memoryDriver(), id = await requestId('test');
  await checkin(memory.driver, id);
  await checkin(memory.driver, id);
  assert.equal(memory.counts().inserts, 1);
  const noReceipt: Driver = { ...memory.driver, find: async () => undefined, insert: async () => {} };
  await assert.rejects(checkin(noReceipt, id), /receipt not found/);
  await assert.rejects(checkin(memory.driver, "' OR 1=1 --"), /Invalid request ID/);
});

test('HTTP cannot trigger writes, including the removed manual endpoint', async () => {
  let opened = 0;
  const factory: DriverFactory = async () => { opened++; return memoryDriver().driver; };
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const response = await handleRequest(new Request('https://test/api/trigger', { method }), env, factory);
    assert.equal(response.status, 404);
  }
  assert.equal((await handleRequest(new Request('https://test/api/status', { method: 'POST' }), env, factory)).status, 405);
  assert.equal(opened, 0);
});

test('status is read-only, reports query failures and never exposes connection fields', async () => {
  const memory = memoryDriver();
  const response = await handleRequest(new Request('https://test/api/status'), env, async () => memory.driver);
  const body = await response.text();
  assert.ok(!body.includes(database.key) && !body.includes(database.url));
  assert.equal(memory.counts().inserts, 0);
  assert.equal(JSON.parse(body).instances[0].last_status, 'EMPTY');
  const failure = await handleRequest(new Request('https://test/api/status'), env, async () => { throw new Error('private'); });
  assert.equal((await failure.json() as { instances: { last_status: string }[] }).instances[0]?.last_status, 'FAILED');
});

test('scheduled retries share an ID across ticks and successful ticks remain idempotent', async () => {
  const memory = memoryDriver();
  const now = (await dailyPlan('one', Date.UTC(2026, 9, 14), { min: 1, max: 3 }))[0]!;
  let attempts = 0;
  const factory: DriverFactory = async () => {
    if (++attempts === 1) throw new Error('temporary network failure');
    return memory.driver;
  };
  await assert.rejects(runScheduled(env, now, factory), /check-ins failed/);
  await runScheduled(env, now + INTERVAL, factory);
  await runScheduled(env, now + INTERVAL * 2, factory);
  assert.equal(memory.counts().inserts, 1);
});

test('Oracle commits explicitly and rejects errors in any ORDS statement', async () => {
  const sql: string[] = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sql.push(JSON.parse(String(init.body)).statementText);
    return new Response(JSON.stringify({ items: [{ errorCode: 0 }] }));
  });
  try {
    const driver = new Oracle({ id: 'adb', name: 'ADB', region: '', type: 'oracle', url: 'https://example.com/ords/schema', user: 'schema', password: 'secret' });
    await driver.insert(await requestId('oracle'));
    assert.match(sql[0]!, /COMMIT;/);
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ items: [{ errorCode: 0 }, { errorCode: 942, errorDetails: 'secret upstream SQL' }] })));
    await assert.rejects(driver.latest(), /Oracle SQL error 942/);
  } finally { fetchMock.mock.restore(); }
});

test('Supabase secret keys are not sent as JWTs; duplicate inserts request ignore-duplicates', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), database.key);
    assert.equal(headers.get('Authorization'), null);
    assert.match(headers.get('Prefer')!, /ignore-duplicates/);
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 201 });
  });
  try { await new Supabase(database).insert(await requestId('supabase')); }
  finally { fetchMock.mock.restore(); }
});

test('database redirects are rejected without forwarding credentials', async () => {
  let calls = 0;
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
  });
  try {
    await assert.rejects(new Supabase(database).latest(), /HTTP 302/);
    assert.equal(calls, 1);
  } finally { fetchMock.mock.restore(); }
});

test('MySQL only ignores duplicate keys; permission errors still fail without UPDATE or DDL', async () => {
  let errno = 1062;
  const connection = { end: async () => {}, destroy: () => {}, query: async (query: unknown) => {
    assert.ok(query && typeof query === 'object' && 'sql' in query && typeof query.sql === 'string');
    assert.match(query.sql, /^INSERT INTO/);
    assert.doesNotMatch(query.sql, /UPDATE|CREATE|IGNORE/);
    throw { errno };
  } } satisfies Pick<Connection, 'query' | 'end' | 'destroy'>;
  const driver = new MySQL(connection);
  await driver.insert(await requestId('mysql'));
  errno = 1142;
  await assert.rejects(driver.insert(await requestId('mysql')));
  assert.equal(safeMessage(new Error('sensitive payload')), 'Database request failed; check connectivity and credentials.');
});
