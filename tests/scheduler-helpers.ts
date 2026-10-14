import { SchedulerRunner, type SchedulerState, type SchedulerStore } from '../src/scheduler-runner.ts';
import type { DriverFactory } from '../src/execute.ts';

export class MemoryStore implements SchedulerStore {
  state: SchedulerState | undefined;
  alarmAt = 0;
  async load() { return structuredClone(this.state); }
  async save(state: SchedulerState, alarmAt: number) { this.state = structuredClone(state); this.alarmAt = alarmAt; }
}

export function schedulerHarness(env: Env, now: number, factory?: DriverFactory, store = new MemoryStore()) {
  const clock = { now };
  const runner = new SchedulerRunner(store, env, () => clock.now, factory);
  return { clock, store, runner, async tick(time = store.alarmAt) { clock.now = time; await runner.fire(); } };
}
