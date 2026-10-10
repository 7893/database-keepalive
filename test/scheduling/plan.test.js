import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPlan, dueCheckins } from '../../src/scheduling/plan.js';
import { SERVICES } from '../../src/config/services.js';
import { handle } from '../../src/http/handler.js';

const testToken = 'test-scheduler-token';
const request = stamp => new Request('https://keepalive.test/internal/tick', {
  method: 'POST', headers: { 'x-keepalive-scheduler': testToken,
    ...(stamp ? { 'x-cloudscheduler-scheduletime': stamp } : {}) }
});

test('daily plan assigns one to three check-ins per service in distinct UTC+8 windows and minutes', () => {
  for (const day of ['2026-01-01', '2026-10-10', '2028-02-29']) {
    const plan = dailyPlan(day);
    assert.ok(plan.length >= 5 && plan.length <= 15);
    assert.equal(new Set(plan.map(entry => entry.plannedAt)).size, plan.length);
    assert.deepEqual(plan, dailyPlan(day));
    for (const service of SERVICES) {
      const entries = plan.filter(entry => entry.service === service);
      assert.ok(entries.length >= 1 && entries.length <= 3);
      const windows = entries.map(entry => {
        const local = new Date(Date.parse(entry.plannedAt) + 8 * 3600_000);
        assert.equal(local.toISOString().slice(0, 10), day);
        return Math.floor(local.getUTCHours() / 8);
      });
      assert.equal(new Set(windows).size, entries.length);
    }
  }
  assert.notDeepEqual(dailyPlan('2026-10-10').map(e=>e.plannedAt.slice(11)),
    dailyPlan('2026-10-11').map(e=>e.plannedAt.slice(11)));
  assert.throws(()=>dailyPlan('2026-02-29'));
});

test('each UTC+8 minute selects at most one service, with no missing or extra daily tasks', () => {
  const start = Date.parse('2026-10-09T16:00:00Z');
  const actual = [];
  for (let minute = 0; minute < 1440; minute++) {
    const due = dueCheckins(new Date(start + minute * 60_000).toISOString());
    assert.ok(due.length <= 1);
    actual.push(...due);
  }
  assert.deepEqual(actual, dailyPlan('2026-10-10'));
});

test('late retries use scheduled time and reproduce the same single-service payload', async () => {
  const calls = [];
  const env = { SCHEDULER_TOKEN: testToken, backends: Object.fromEntries(SERVICES.map(service =>
    [service, { ping: async (geo, id) => {calls.push({service, geo, id}); return true;} }])) };
  const entry = dailyPlan('2020-01-01')[0]; // Deliberately unrelated to current time.
  for (let retry = 0; retry < 2; retry++) {
    const result = await handle(request(entry.plannedAt), env);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).results, {[entry.service]: true});
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].service, entry.service);
});

test('empty ticks, malformed timestamps and unauthorized callers cannot write', async () => {
  let writes = 0;
  const env = { SCHEDULER_TOKEN: testToken, backends: Object.fromEntries(SERVICES.map(service =>
    [service, { ping: async () => {writes++; return true;} }])) };
  const planned = dailyPlan('2026-10-10');
  let empty = Date.parse('2026-10-09T16:00:00Z');
  while (planned.some(entry=>Date.parse(entry.plannedAt)===empty)) empty += 60_000;
  const response = await handle(request(new Date(empty).toISOString()), env);
  assert.deepEqual(await response.json(), {success:true,results:{}});
  for (const stamp of [undefined, 'invalid', '2026-10-10', '2026-13-10T00:00:00Z'])
    assert.equal((await handle(request(stamp), env)).status, 400);
  const anonymous = new Request('https://keepalive.test/internal/tick', {method:'POST'});
  assert.equal((await handle(anonymous, env)).status, 401);
  assert.equal(writes, 0);
});


test('counts vary by day and are drawn separately for each database', () => {
  const seen = Object.fromEntries(SERVICES.map(service => [service, new Set()]));
  let independent = false;
  for (let day = 1; day <= 31; day++) {
    const plan = dailyPlan(`2026-10-${String(day).padStart(2, '0')}`);
    const counts = SERVICES.map(service => {
      const count = plan.filter(entry => entry.service === service).length;
      assert.ok(count >= 1 && count <= 3);
      seen[service].add(count);
      return count;
    });
    independent ||= new Set(counts).size > 1;
  }
  assert.ok(independent);
  for (const values of Object.values(seen)) assert.deepEqual([...values].sort(), [1, 2, 3]);
});

test('selected slots retain pre-release timestamps and request identities', () => {
  const previous = new Set([
    "adb_jp|daily:v1:2026-10-11:0|2026-10-10T16:04:00.000Z",
    "adb_us|daily:v1:2026-10-11:0|2026-10-10T16:28:00.000Z",
    "supabase|daily:v1:2026-10-11:0|2026-10-10T20:48:00.000Z",
    "db2|daily:v1:2026-10-11:0|2026-10-10T22:14:00.000Z",
    "mysql_jp|daily:v1:2026-10-11:0|2026-10-10T22:37:00.000Z",
    "supabase|daily:v1:2026-10-11:1|2026-10-11T03:18:00.000Z",
    "adb_us|daily:v1:2026-10-11:1|2026-10-11T04:14:00.000Z",
    "adb_jp|daily:v1:2026-10-11:1|2026-10-11T04:19:00.000Z",
    "db2|daily:v1:2026-10-11:1|2026-10-11T05:10:00.000Z",
    "mysql_jp|daily:v1:2026-10-11:1|2026-10-11T06:34:00.000Z",
    "adb_jp|daily:v1:2026-10-11:2|2026-10-11T08:32:00.000Z",
    "mysql_jp|daily:v1:2026-10-11:2|2026-10-11T08:47:00.000Z",
    "adb_us|daily:v1:2026-10-11:2|2026-10-11T11:39:00.000Z",
    "supabase|daily:v1:2026-10-11:2|2026-10-11T14:00:00.000Z",
    "db2|daily:v1:2026-10-11:2|2026-10-11T14:23:00.000Z",
  ]);
  for (const entry of dailyPlan('2026-10-11'))
    assert.ok(previous.has(`${entry.service}|${entry.execution}|${entry.plannedAt}`));
});
