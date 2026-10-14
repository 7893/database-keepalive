export type DatabaseConfig = {
  id: string;
  name: string;
  region: string;
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
  try { entries = JSON.parse(json); } catch { throw new SafeError('DATABASES must be a JSON array.'); }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10) {
    throw new SafeError('Configure between 1 and 10 database instances.');
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
    const base = { id, name: field('name', id), region: typeof value.region === 'string' ? value.region : '' };
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
  const low = Number(min ?? 1), high = Number(max ?? 3);
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high < low || high > 12) {
    throw new SafeError('DAILY_MIN and DAILY_MAX must satisfy 1 <= min <= max <= 12.');
  }
  return { min: low, max: high };
}
