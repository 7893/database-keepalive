import { safeMessage, retentionRule, type Retention, type DatabaseConfig } from './config.ts';
import { checkin, openDriver, type Driver } from './db.ts';

export type DriverFactory = (config: DatabaseConfig, env: Env) => Promise<Driver>;

export async function writeOne(config: DatabaseConfig, env: Env, id: string, factory: DriverFactory = openDriver, retention: Retention = false) {
  let driver: Driver | undefined;
  const start = Date.now();
  try {
    driver = await factory(config, env);
    const record = await checkin(driver, id);
    const rule = retentionRule(retention);
    let retentionError: string | undefined;
    if (rule) {
      try { await driver.prune(rule); }
      catch (error) { retentionError = safeMessage(error); }
    }
    return { ok: true, record, ...(retentionError ? { retention_error: retentionError } : {}), duration_ms: Date.now() - start };
  } catch (error) {
    return { ok: false, error: safeMessage(error), duration_ms: Date.now() - start };
  } finally { await driver?.close(); }
}
