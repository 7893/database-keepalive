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

test('daily plan assigns three check-ins per service, one per UTC+8 window, with 15 distinct minutes', () => {
  for (const day of ['2026-01-01', '2026-10-10', '2028-02-29']) {
    const plan = dailyPlan(day);
    assert.equal(plan.length, 15);
    assert.equal(new Set(plan.map(entry => entry.plannedAt)).size, 15);
    assert.deepEqual(plan, dailyPlan(day));
    for (const service of SERVICES) {
      const entries = plan.filter(entry => entry.service === service);
      assert.equal(entries.length, 3);
      const windows = entries.map(entry => {
        const local = new Date(Date.parse(entry.plannedAt) + 8 * 3600_000);
        assert.equal(local.toISOString().slice(0, 10), day);
        return Math.floor(local.getUTCHours() / 8);
      });
      assert.deepEqual(windows, [0, 1, 2]);
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
