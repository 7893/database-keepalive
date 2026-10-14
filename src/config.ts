export type Retention = false | { maxAgeDays: number; maxRows?: never } | { maxRows: number; maxAgeDays?: never };

export type DailyCheckins = number | { min: number; max: number };

export type DatabaseConfig = {
  id: string;
  name: string;
  region: string;
  dailyCheckins?: DailyCheckins;
  retention?: Retention;
} & (
  | { type: 'supabase'; url: string; key: string }
  | { type: 'oracle'; url: string; user: string; password: string }
  | { type: 'mysql'; binding: string }
);

export class SafeError extends Error {}

export function safeMessage(error: unknown): string {
  return error instanceof SafeError ? error.message : 'Database request failed; check connectivity and credentials.';
}

export function parseDatabases(json: string): DatabaseConfig[] {
  let entries: unknown;
  try { entries = JSON.parse(json); } catch { throw new SafeError('databases must be a JSON array.'); }
  return validateDatabases(entries);
}

function validateDatabases(entries: unknown): DatabaseConfig[] {
  if (!Array.isArray(entries) || entries.length < 1) {
    throw new SafeError('Configure at least one database instance.');
  }
  const seen = new Set<string>();
  return entries.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new SafeError('Invalid database configuration.');
    const value = entry as Record<string, unknown>;
    const field = (key: string, fallback?: string): string => {
      const result = value[key] ?? fallback;
      if (typeof result !== 'string' || !result.trim()) throw new SafeError(`Database field ${key} is required.`);
      return result;
    };
    const id = field('id');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || seen.has(id)) throw new SafeError('Database IDs must be unique letters, digits, underscores or hyphens (max 64).');
    seen.add(id);
    const base = { id, name: field('name', id), region: typeof value.region === 'string' ? value.region : '',
      ...(value.retention === undefined ? {} : { retention: parseRetention(value.retention) }),
      ...(value.dailyCheckins === undefined ? {} : { dailyCheckins: parseDailyCheckins(value.dailyCheckins) }),
    };
    if (value.type === 'mysql') {
      const binding = field('binding');
      if (!/^[A-Z][A-Z0-9_]*$/.test(binding)) throw new SafeError('MySQL binding must be an uppercase binding name.');
      return { ...base, type: 'mysql', binding };
    }
    if (value.type !== 'supabase' && value.type !== 'oracle') throw new SafeError('Supported database types: supabase, oracle, mysql.');
    let url: URL;
    try { url = new URL(field('url')); } catch { throw new SafeError('Database URL must be an HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new SafeError('Database URL must use HTTPS without embedded credentials, query or fragment.');
    }
    const endpoint = url.toString().replace(/\/+$/, '');
    return value.type === 'supabase'
      ? { ...base, type: 'supabase', url: endpoint, key: field('key') }
      : { ...base, type: 'oracle', url: endpoint, user: field('user'), password: field('password') };
  });
}

export function schedulePolicy(min: unknown, max: unknown): { min: number; max: number } {
  const low = min ?? 1, high = max ?? 3;
  if (typeof low !== 'number' || typeof high !== 'number' || !Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high < low || high > 72) {
    throw new SafeError('dailyCheckins must satisfy 1 <= min <= max <= 72.');
  }
  return { min: low, max: high };
}

export function parseDailyCheckins(value: unknown): DailyCheckins {
  if (typeof value === 'number') {
    schedulePolicy(value, value);
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SafeError('dailyCheckins must be a number or an object with min and max.');
  const range = value as Record<string, unknown>;
  if (range.min === undefined || range.max === undefined) throw new SafeError('dailyCheckins requires both min and max.');
  return schedulePolicy(range.min, range.max);
}

export function dailyPolicy(value: DailyCheckins): { min: number; max: number } {
  return typeof value === 'number' ? { min: value, max: value } : value;
}

// Select exactly one rule so configuration never depends on key order.
export function parseRetention(value: unknown): Retention {
  if (value === false) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SafeError('retention must be false or an object with maxAgeDays or maxRows.');
  const entries = Object.entries(value);
  if (entries.length !== 1) throw new SafeError('retention requires exactly one rule: maxAgeDays or maxRows.');
  for (const [key, count] of entries) {
    if (key !== 'maxAgeDays' && key !== 'maxRows') throw new SafeError('Unknown retention rule; use maxAgeDays or maxRows.');
    const min = key === 'maxAgeDays' ? 3 : 12;
    const max = key === 'maxAgeDays' ? 36500 : 2147483647;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < min || count > max) throw new SafeError(`retention.${key} must be an integer from ${min} to ${max}.`);
  }
  return Object.fromEntries(entries) as Exclude<Retention, false>;
}

export type RetentionRule = { mode: 'maxAgeDays' | 'maxRows'; value: number };
export function retentionRule(retention: Retention): RetentionRule | undefined {
  if (retention === false) return undefined;
  const validated = parseRetention(retention) as Exclude<Retention, false>;
  const [mode, value] = Object.entries(validated)[0]!;
  return { mode: mode as RetentionRule['mode'], value };
}

export interface AppConfig {
  timezone: string;
  dailyCheckins: DailyCheckins;
  retention: Retention;
  databases: DatabaseConfig[];
}

export function parseConfig(json: string): AppConfig {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new SafeError('Configuration must be valid JSON.'); }
  return validateConfig(value);
}

export function validateConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SafeError('Configuration must be an object.');
  const config = value as Record<string, unknown>;
  const timezone = config.timezone ?? 'Asia/Hong_Kong';
  if (typeof timezone !== 'string' || !timezone.trim()) throw new SafeError('timezone must be a valid IANA timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { throw new SafeError('timezone must be a valid IANA timezone.'); }
  return {
    timezone,
    retention: config.retention === undefined ? { maxRows: 64 } : parseRetention(config.retention),
    dailyCheckins: parseDailyCheckins(config.dailyCheckins ?? { min: 1, max: 3 }),
    databases: validateDatabases(config.databases),
  };
}
