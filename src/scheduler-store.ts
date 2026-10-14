import type { Job, SchedulerState, SchedulerStore } from './scheduler-runner.ts';

type Header = Omit<SchedulerState, 'jobs'> & { chunks: number };
const CHUNK_SIZE = 256; // Keep each KV value well below the 128 KiB limit.
const jobKey = (index: number) => `schedule:jobs:${index}`;

export class DurableSchedulerStore implements SchedulerStore {
  private storage: DurableObjectStorage;
  constructor(storage: DurableObjectStorage) { this.storage = storage; }

  async load(): Promise<SchedulerState | undefined> {
    return this.storage.transaction(async txn => {
      const header = await txn.get<Header>('schedule');
      if (!header) return undefined;
      const jobs: Job[] = [];
      for (let i = 0; i < header.chunks; i++) {
        const chunk = await txn.get<Job[]>(jobKey(i));
        if (!chunk) throw new Error('Incomplete scheduler state.');
        jobs.push(...chunk);
      }
      return { day: header.day, nextAllowedAt: header.nextAllowedAt, jobs };
    });
  }

  async save(state: SchedulerState, alarmAt: number): Promise<void> {
    await this.storage.transaction(async txn => {
      const previous = await txn.get<Header>('schedule');
      const chunks = Math.ceil(state.jobs.length / CHUNK_SIZE);
      await txn.put('schedule', { day: state.day, nextAllowedAt: state.nextAllowedAt, chunks } satisfies Header);
      for (let i = 0; i < chunks; i++) await txn.put(jobKey(i), state.jobs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      for (let i = chunks; i < (previous?.chunks ?? 0); i++) await txn.delete(jobKey(i));
      await txn.setAlarm(alarmAt);
    });
  }
}
