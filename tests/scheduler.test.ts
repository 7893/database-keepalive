import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetPlan, planNodes, DAY, INTERVAL, RETRY_WINDOW, MIN_GAP, type PlanNode } from '../src/schedule.ts';
import { parseConfig } from '../src/config.ts';
import type { DriverFactory } from '../src/execute.ts';
import type { Checkin } from '../src/db.ts';
import { schedulerHarness, MemoryStore } from './scheduler-helpers.ts';

const day = Date.UTC(2026, 9, 14);
const nodes = (count: number): PlanNode[] => Array.from({ length: count }, (_, i) => ({ id: `db-${i}`, policy: { min: 1, max: 3 } }));
const envFor = (count: number, dailyCheckins: number | { min: number; max: number } = 3) => ({
  CONFIG: JSON.stringify({ dailyCheckins, retention: false, databases: nodes(count).map(node => ({ id: node.id, type: 'mysql', binding: 'MYSQL_JP' })) }),
}) as Env;

function fakeFactory() {
  const receipts = new Map<string, Checkin>();
  const calls: string[] = [];
  let active = 0, peak = 0, inserts = 0;
  const factory: DriverFactory = async config => {
    calls.push(config.id); active++; peak = Math.max(active, peak);
    return {
      find: async id => receipts.get(`${config.id}:${id}`),
      latest: async () => [],
      insert: async id => { inserts++; receipts.set(`${config.id}:${id}`, { id, ping_time: new Date().toISOString(), status: 'SUCCESS' }); },
      prune: async () => {},
      close: async () => { active--; },
    };
  };
  return { factory, calls, receipts, counts: () => ({ active, peak, inserts }) };
}

test('fleet plans preserve every node count, randomize hours/minutes/seconds and avoid collisions across days', async () => {
  const fleet = nodes(40).map((node, i) => ({ ...node, policy: { min: i % 2 ? 72 : 3, max: i % 2 ? 72 : 3 } }));
  const hours = new Set<number>(), minutes = new Set<number>(), seconds = new Set<number>();
  const first = await fleetPlan(fleet, day);
  assert.deepEqual(first, await fleetPlan([...fleet].reverse(), day + 4321));
  assert.notDeepEqual(first.map(x => x.databaseId), (await fleetPlan(fleet, day + DAY)).map(x => x.databaseId));
  for (let d = 0; d < 5; d++) {
    const plan = await fleetPlan(fleet, day + d * DAY);
    assert.equal(new Set(plan.map(x => x.time)).size, plan.length);
    for (const node of fleet) assert.equal(plan.filter(event => event.databaseId === node.id).length, node.policy.min);
    for (const event of plan) {
      assert.ok(event.time >= day + d * DAY && event.time < day + (d + 1) * DAY);
      assert.equal(event.time % 1000, 0);
      const date = new Date(event.time);
      hours.add(date.getUTCHours()); minutes.add(date.getUTCMinutes()); seconds.add(date.getUTCSeconds());
    }
  }
  assert.equal(hours.size, 24); assert.equal(minutes.size, 60); assert.equal(seconds.size, 60);
});

test('mixed fixed and random policies keep per-node bounds and reject impossible capacity', async () => {
  const config = parseConfig(JSON.stringify({ dailyCheckins: { min: 2, max: 5 }, databases: [
    { id: 'fixed', type: 'mysql', binding: 'MYSQL_JP', dailyCheckins: 7 },
    { id: 'range', type: 'mysql', binding: 'MYSQL_JP' },
  ] }));
  for (let i = 0; i < 20; i++) {
    const plan = await fleetPlan(planNodes(config), day + i * DAY);
    assert.equal(plan.filter(x => x.databaseId === 'fixed').length, 7);
    const count = plan.filter(x => x.databaseId === 'range').length;
    assert.ok(count >= 2 && count <= 5);
  }
  await assert.rejects(fleetPlan(nodes(1201).map(node => ({ ...node, policy: { min: 72, max: 72 } })), day), /Too many/);
});

test('multiple databases execute once each at their planned seconds with no concurrent connections', async () => {
  const env = envFor(12, 4), fake = fakeFactory();
  const harness = schedulerHarness(env, day, fake.factory);
  const plan = await fleetPlan(planNodes(parseConfig(env.CONFIG)), day);
  await harness.tick(day);
  for (const event of plan) {
    await harness.tick(harness.store.alarmAt);
    assert.equal(fake.calls.at(-1), event.databaseId);
  }
  assert.equal(fake.counts().inserts, 48);
  assert.equal(fake.counts().peak, 1);
  assert.equal(fake.counts().active, 0);
  assert.ok(harness.store.state!.jobs.every(job => job.done));
  const preview = await harness.runner.nextTimes();
  assert.ok(Object.values(preview).every(time => Date.parse(time) >= day + DAY));
});

test('late alarms serialize a backlog and wait a full second after a slow attempt', async () => {
  const env = envFor(3, 1), fake = fakeFactory();
  const store = new MemoryStore();
  store.state = { day, nextAllowedAt: 0, jobs: nodes(3).map((node, i) => ({ databaseId: node.id, time: day + i * 1000, retryAt: day + i * 1000, done: false })) };
  const harness = schedulerHarness(env, day + 5000, async (config, env) => {
    const driver = await fake.factory(config, env);
    return { ...driver, close: async () => { harness.clock.now += 12345; await driver.close(); } };
  }, store);
  await harness.tick(day + 5000);
  assert.equal(fake.calls.length, 1);
  assert.ok(store.alarmAt >= harness.clock.now + MIN_GAP);
  await harness.tick(harness.clock.now); // Duplicate/early delivery must not write.
  assert.equal(fake.calls.length, 1);
  await harness.tick(store.alarmAt);
  await harness.tick(store.alarmAt);
  assert.equal(fake.calls.length, 3); assert.equal(fake.counts().peak, 1);
});

test('restarts and duplicate alarms reuse persisted plans and completed jobs', async () => {
  const env = envFor(3, 1), fake = fakeFactory();
  const harness = schedulerHarness(env, day, fake.factory);
  await harness.tick(day);
  const first = harness.store.alarmAt;
  await harness.tick(first);
  const restarted = schedulerHarness(env, first, fake.factory, harness.store);
  await restarted.tick(first);
  assert.equal(fake.calls.length, 1);
  await restarted.tick(harness.store.alarmAt);
  assert.equal(fake.calls.length, 2);
});

test('midnight carries live retries, expires old work and loads the next day', async () => {
  const env = envFor(2, 1), fake = fakeFactory(), store = new MemoryStore();
  store.state = { day, nextAllowedAt: 0, jobs: [
    { databaseId: 'db-0', time: day + DAY - 1000, retryAt: day + DAY + 1000, done: false },
    { databaseId: 'db-1', time: day + DAY - RETRY_WINDOW, retryAt: day + DAY, done: false },
  ] };
  const harness = schedulerHarness(env, day + DAY, fake.factory, store);
  await harness.tick(day + DAY);
  assert.equal(store.state!.day, day + DAY);
  assert.equal(store.state!.jobs.filter(job => job.time < day + DAY).length, 1);
  await harness.tick(day + DAY + 1000);
  assert.deepEqual(fake.calls, ['db-0']);
});

test('configuration edits freeze current counts, skip removed nodes and include additions tomorrow', async () => {
  const env = envFor(2, 2), fake = fakeFactory();
  const harness = schedulerHarness(env, day, fake.factory);
  await harness.tick(day);
  const before = structuredClone(harness.store.state!.jobs);
  const settings = JSON.parse(env.CONFIG);
  settings.databases = [settings.databases[0], { id: 'new', type: 'mysql', binding: 'MYSQL_JP' }];
  settings.dailyCheckins = 5;
  env.CONFIG = JSON.stringify(settings);
  await harness.tick(day + 1000);
  assert.deepEqual(harness.store.state!.jobs.map(x => x.time), before.map(x => x.time));
  assert.ok(harness.store.state!.jobs.filter(x => x.databaseId === 'db-1').every(x => x.done));
  assert.equal(harness.store.state!.jobs.filter(x => x.databaseId === 'new').length, 0);
  const preview = await harness.runner.nextTimes();
  assert.ok(Date.parse(preview.new!) >= day + DAY);
  await harness.tick(day + DAY);
  assert.equal(harness.store.state!.jobs.filter(x => x.databaseId === 'new').length, 5);
});

test('failed attempts retry without blocking another database and stop at the retry deadline', async () => {
  const env = envFor(2, 1), fake = fakeFactory(), store = new MemoryStore();
  store.state = { day, nextAllowedAt: 0, jobs: nodes(2).map((node, i) => ({ databaseId: node.id, time: day + i * 1000, retryAt: day + i * 1000, done: false })) };
  let attempts = 0;
  const harness = schedulerHarness(env, day, async (config, env) => {
    if (config.id === 'db-0') { attempts++; throw new Error('private'); }
    return fake.factory(config, env);
  }, store);
  await harness.tick(day);
  await harness.tick(store.alarmAt);
  assert.deepEqual(fake.calls, ['db-1']);
  await harness.tick(day + INTERVAL);
  await harness.tick(day + 2 * INTERVAL);
  await harness.tick(day + RETRY_WINDOW);
  assert.equal(attempts, 3);
  assert.ok(store.state!.jobs.every(x => x.done));
});

test('read-only previews serialize overdue estimates without mutating alarms or plans', async () => {
  const env = envFor(3, 1), store = new MemoryStore();
  store.state = { day, nextAllowedAt: day + 5000, jobs: nodes(3).map((node, i) => ({ databaseId: node.id, time: day + i * 1000, retryAt: day + i * 1000, done: false })) };
  const harness = schedulerHarness(env, day + 4000, undefined, store);
  const before = structuredClone(store.state);
  const preview = await harness.runner.nextTimes();
  assert.deepEqual(Object.values(preview).map(Date.parse), [day + 5000, day + 6000, day + 7000]);
  assert.deepEqual(store.state, before);
  assert.equal(store.alarmAt, 0);
});

test('a crash after database commit but before state commit recovers without a second insert', async () => {
  const env = envFor(1, 1), fake = fakeFactory();
  class FailingStore extends MemoryStore {
    writes = 0;
    override async save(state: Parameters<MemoryStore['save']>[0], alarm: number) {
      if (++this.writes === 4) throw new Error('simulated storage failure');
      return super.save(state, alarm);
    }
  }
  const store = new FailingStore();
  const harness = schedulerHarness(env, day, fake.factory, store);
  await harness.tick(day);
  const time = store.alarmAt;
  await assert.rejects(harness.tick(time), /simulated storage failure/);
  assert.equal(fake.counts().inserts, 1);
  const recovered = schedulerHarness(env, time + 2000, fake.factory, store);
  await recovered.tick(time + 2000);
  assert.equal(fake.counts().inserts, 1);
  assert.ok(store.state!.jobs.every(job => job.done));
});

test('valid IDs that match object property names retain their next scheduled time', async () => {
  const env = { CONFIG: JSON.stringify({ retention: false, databases: ['__proto__', 'constructor', 'toString'].map(id => ({ id, type: 'mysql', binding: 'MYSQL_JP' })) }) } as Env;
  const harness = schedulerHarness(env, day);
  const preview = await harness.runner.nextTimes();
  assert.equal(Object.getPrototypeOf(preview), Object.prototype);
  for (const id of ['__proto__', 'constructor', 'toString']) {
    assert.ok(Object.hasOwn(preview, id));
    assert.ok(Number.isFinite(Date.parse(preview[id]!)));
  }
});
