import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseDatabases, schedulePolicy, safeMessage, SafeError, parseConfig, dailyPolicy } from '../src/config.ts';
import { dailyPlan, dueTimes, nextTime, requestId, INTERVAL, RETRY_WINDOW } from '../src/schedule.ts';
import { checkin, Oracle, Supabase, MySQL, type Driver, type Checkin } from '../src/db.ts';
import { handleRequest, runScheduled, type DriverFactory } from '../src/worker.ts';
import type { Connection } from 'mysql2/promise';

const database = { id: 'one', type: 'supabase', url: 'https://example.com', key: 'sb_secret_test', name: 'One', region: '' } as const;
const env = { CONFIG: JSON.stringify({ timezone: 'Asia/Hong_Kong', dailyCheckins: { min: 1, max: 3 }, databases: [database] }) } as Env;
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
  assert.throws(() => schedulePolicy(1, 73));
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

test('configuration supports repeated database types, global counts and per-node overrides', () => {
  const types = [database,
    { id: 'adb', type: 'oracle', url: 'https://example.com/ords/schema', user: 'schema', password: 'private' },
    { id: 'mysql', type: 'mysql', binding: 'MYSQL_JP' }];
  const databases = Array.from({ length: 30 }, (_, i) => ({ ...types[i % 3], id: `node-${i}`, ...(i === 0 ? { dailyCheckins: 2 } : {}) }));
  const config = parseConfig(JSON.stringify({ timezone: 'Europe/London', dailyCheckins: { min: 2, max: 5 }, databases }));
  assert.equal(config.databases.length, 30);
  assert.deepEqual(dailyPolicy(config.databases[0]!.dailyCheckins!), { min: 2, max: 2 });
  assert.deepEqual(dailyPolicy(config.databases[1]!.dailyCheckins ?? config.dailyCheckins), { min: 2, max: 5 });
  for (const dailyCheckins of [0, 73, 1.5, '3', {}, { min: 2 }, { min: 4, max: 2 }, { min: 1, max: 2.5 }]) {
    assert.throws(() => parseConfig(JSON.stringify({ databases: [database], dailyCheckins })), SafeError);
    assert.throws(() => parseConfig(JSON.stringify({ databases: [{ ...database, dailyCheckins }] })), SafeError);
  }
  assert.throws(() => parseConfig(JSON.stringify({ databases: [database], timezone: 'not/a-timezone' })), SafeError);
});

test('fixed counts are exact and random ranges remain bounded up to 72 events', async () => {
  const day = Date.UTC(2026, 9, 14);
  for (const count of [1, 3, 12, 36, 72]) {
    const plan = await dailyPlan('fixed', day, dailyPolicy(count));
    assert.equal(plan.length, count);
    assert.equal(new Set(plan).size, count);
    assert.ok(plan.every(t => t >= day && t < day + 86_400_000));
    assert.ok(plan.slice(1).every((t, i) => t - plan[i]! >= RETRY_WINDOW));
  }
  const counts = new Set<number>();
  for (let i = 0; i < 30; i++) {
    const plan = await dailyPlan('random', day + i * 86_400_000, { min: 2, max: 5 });
    assert.ok(plan.length >= 2 && plan.length <= 5);
    counts.add(plan.length);
  }
  assert.ok(counts.size > 1);
});

test('display timezone does not change UTC scheduling and many nodes use bounded connections', async () => {
  const clock = mock.method(Date, 'now', () => Date.UTC(2026, 9, 14, 12));
  const databases = Array.from({ length: 24 }, (_, i) => ({ ...database, id: `node-${i}` }));
  let active = 0, peak = 0;
  const factory: DriverFactory = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    return { ...memoryDriver().driver, close: async () => { active--; } };
  };
  try {
    const responses = [];
    for (const timezone of ['Asia/Hong_Kong', 'America/New_York']) {
      const configEnv = { ...env, CONFIG: JSON.stringify({ timezone, dailyCheckins: 3, databases }) };
      const response = await handleRequest(new Request('https://test/api/status'), configEnv, factory);
      const body = await response.json() as { timezone: string; instances: { id: string; next_time: string }[] };
      assert.equal(body.timezone, timezone);
      assert.equal(body.instances.length, databases.length);
      assert.deepEqual(body.instances.map(x => x.id), databases.map(x => x.id));
      responses.push(body.instances.map(x => x.next_time));
    }
    assert.deepEqual(responses[0], responses[1]);
    assert.ok(peak <= 4);
    assert.equal(active, 0);
  } finally { clock.mock.restore(); }
});

test('scheduled handler applies per-node fixed counts rather than the global range', async () => {
  const memory = memoryDriver();
  const settings = { dailyCheckins: { min: 2, max: 5 }, databases: [{ ...database, dailyCheckins: 1 }] };
  const configEnv = { ...env, CONFIG: JSON.stringify(settings) };
  const day = Date.UTC(2026, 9, 14);
  const planned = (await dailyPlan(database.id, day, { min: 1, max: 1 }))[0]!;
  await runScheduled(configEnv, planned, async () => memory.driver);
  await runScheduled(configEnv, planned + INTERVAL, async () => memory.driver);
  assert.equal(memory.counts().inserts, 1);
  assert.ok(memory.rows.has(await requestId(`scheduled-v1:${database.id}:${planned}`)));
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

test('timezone-less database times are UTC even on a non-UTC host', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { ...record, ping_time: '2026-10-14T03:43:59.776879' },
    { ...record, ping_time: '2026-10-14T11:43:59.776+08:00' },
  ])));
  try {
    const rows = await new Supabase(database).latest();
    assert.equal(rows[0]?.ping_time, '2026-10-14T03:43:59.776Z');
    assert.equal(rows[1]?.ping_time, rows[0]?.ping_time);
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', hourCycle: 'h23' }).format(new Date(rows[0]!.ping_time));
    assert.equal(hour, '11');
  } finally {
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
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
