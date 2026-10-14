import { parseConfig, safeMessage } from './config.ts';
import { writeOne, type DriverFactory } from './execute.ts';
import { DAY, INTERVAL, RETRY_WINDOW, MIN_GAP, utcDay, fleetPlan, planNodes, requestId, type PlannedEvent } from './schedule.ts';

export type Job = PlannedEvent & { retryAt: number; done: boolean };
export type SchedulerState = { day: number; jobs: Job[]; nextAllowedAt: number };
export interface SchedulerStore {
  load(): Promise<SchedulerState | undefined>;
  // State and the next alarm must be committed together.
  save(state: SchedulerState, alarmAt: number): Promise<void>;
}

export class SchedulerRunner {
  private store: SchedulerStore;
  private env: Env;
  private now: () => number;
  private factory: DriverFactory | undefined;
  constructor(store: SchedulerStore, env: Env, now = Date.now, factory?: DriverFactory) {
    this.store = store; this.env = env; this.now = now; this.factory = factory;
  }

  private async stateAt(now: number): Promise<SchedulerState> {
    const settings = parseConfig(this.env.CONFIG);
    const state = await this.store.load();
    const day = utcDay(now);
    if (state?.day === day) return state;
    const carry = state?.jobs.filter(job => !job.done && job.time > now - RETRY_WINDOW) ?? [];
    const jobs = (await fleetPlan(planNodes(settings), day)).map(event => ({
      ...event, retryAt: event.time, done: event.time <= now - RETRY_WINDOW,
    }));
    return { day, jobs: [...carry, ...jobs], nextAllowedAt: state?.nextAllowedAt ?? 0 };
  }

  // Only the Durable Object alarm calls fire(). Cloudflare serializes alarms for
  // one object even across awaited network I/O. RPC methods never execute writes.
  async fire(): Promise<void> {
    const now = this.now();
    const settings = parseConfig(this.env.CONFIG);
    const state = await this.stateAt(now);
    const databases = new Map(settings.databases.map(node => [node.id, node]));
    for (const job of state.jobs) {
      if (job.time <= now - RETRY_WINDOW || !databases.has(job.databaseId)) job.done = true;
    }
    const pending = () => state.jobs.filter(job => !job.done).sort((a, b) => a.retryAt - b.retryAt || a.time - b.time);
    const nextAlarm = () => Math.max(this.now() + 1, state.nextAllowedAt,
      Math.min(state.day + DAY, pending()[0]?.retryAt ?? Infinity));
    // Persist the frozen plan before any external write. Recovery after an
    // interrupted request uses the same database/time identity.
    await this.store.save(state, nextAlarm());
    const job = pending()[0];
    if (job && job.retryAt <= now && state.nextAllowedAt <= now) {
      const config = databases.get(job.databaseId)!;
      const id = await requestId(`scheduled-v2:${job.databaseId}:${job.time}`);
      try {
        const result = await writeOne(config, this.env, id, this.factory, config.retention ?? settings.retention);
        console.log(JSON.stringify({ event: 'scheduled_checkin', service: config.id, planned_time: new Date(job.time).toISOString(), request_id: id, ...result }));
        job.done = result.ok && !('retention_error' in result && result.retention_error);
      } catch (error) {
        console.log(JSON.stringify({ event: 'scheduled_checkin', service: config.id, request_id: id, ok: false, error: safeMessage(error) }));
      }
      const finished = this.now();
      // At least one second after completion, including retries and slow queries.
      state.nextAllowedAt = Math.ceil((finished + MIN_GAP) / 1000) * 1000;
      if (!job.done) {
        job.retryAt = finished + INTERVAL;
        if (job.retryAt >= job.time + RETRY_WINDOW) job.done = true;
      }
    }
    await this.store.save(state, nextAlarm());
  }

  // Read-only preview: uses the persisted plan, never starts alarms or DB writes.
  async nextTimes(): Promise<Record<string, string>> {
    const now = this.now();
    const state = await this.stateAt(now);
    const settings = parseConfig(this.env.CONFIG);
    const tomorrow = await fleetPlan(planNodes(settings), state.day + DAY);
    const times: Record<string, string> = Object.create(null);
    const enabled = new Set(settings.databases.map(node => node.id));
    const queue = [
      ...state.jobs.filter(job => enabled.has(job.databaseId) && !job.done && job.time > now - RETRY_WINDOW)
        .map(job => ({ databaseId: job.databaseId, time: job.retryAt })),
      ...tomorrow,
    ].sort((a, b) => a.time - b.time);
    let available = Math.max(now, state.nextAllowedAt);
    for (const event of queue) {
      const time = Math.max(event.time, available);
      if (!Object.hasOwn(times, event.databaseId)) times[event.databaseId] = new Date(time).toISOString();
      available = time + MIN_GAP;
    }
    // RPC accepts ordinary objects, not null-prototype dictionaries. Spreading
    // creates own data properties safely even for a database named __proto__.
    return { ...times };
  }
}
