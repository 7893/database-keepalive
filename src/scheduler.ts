import { DurableObject } from 'cloudflare:workers';
import { SchedulerRunner } from './scheduler-runner.ts';
import { DurableSchedulerStore } from './scheduler-store.ts';

// The whole database fleet is the coordination unit: only this named object's
// alarm may write check-ins. HTTP reads and Cron watchdog calls never write them.
export class CheckinScheduler extends DurableObject<Env> {
  private running = false;
  private runner(): SchedulerRunner {
    return new SchedulerRunner(new DurableSchedulerStore(this.ctx.storage), this.env);
  }

  async wake(): Promise<void> {
    if (this.running) return;
    // A duplicate watchdog call must not replace an already scheduled alarm.
    await this.ctx.storage.transaction(async txn => {
      if (await txn.getAlarm() === null) await txn.setAlarm(Date.now() + 1000);
    });
  }

  async nextTimes(): Promise<Record<string, string>> { return this.runner().nextTimes(); }

  async alarm(): Promise<void> {
    this.running = true;
    try { await this.runner().fire(); }
    finally { this.running = false; }
  }
}
