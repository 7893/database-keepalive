import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { SafeError, type DatabaseConfig } from './config.ts';

export interface Checkin { id: string; ping_time: string; status: string }
export interface Driver {
  latest(): Promise<Checkin[]>;
  find(id: string): Promise<Checkin | undefined>;
  insert(id: string): Promise<void>;
  close(): Promise<void>;
}
type Row = { id: unknown; ping_time: unknown; status: unknown };
function records(rows: Row[]): Checkin[] {
  return rows.map(row => {
    // Zone-less database timestamps are UTC by schema contract, never local time.
    const raw = String(row.ping_time);
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw}Z` : raw;
    const time = new Date(utc);
    if (!Number.isFinite(time.getTime()) || row.id == null || typeof row.status !== 'string') throw new SafeError('Invalid database receipt.');
    return { id: String(row.id), ping_time: time.toISOString(), status: row.status };
  });
}

export class Supabase implements Driver {
  private config: Extract<DatabaseConfig, { type: 'supabase' }>;
  constructor(config: Extract<DatabaseConfig, { type: 'supabase' }>) { this.config = config; }
  private async query(query: string, id?: string): Promise<Checkin[]> {
    const response = await fetch(`${this.config.url}/rest/v1/my_keepalive_logs?${query}`, {
      method: id ? 'POST' : 'GET',
      headers: {
        apikey: this.config.key,
        // Supabase's newer sb_secret_ keys go in apikey, never as JWTs.
        ...(this.config.key.startsWith('eyJ') ? { Authorization: `Bearer ${this.config.key}` } : {}),
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      ...(id ? { body: JSON.stringify({ request_id: id, status: 'SUCCESS' }) } : {}),
      signal: AbortSignal.timeout(12_000), redirect: 'manual',
    });
    if (!response.ok) { await response.body?.cancel(); throw new SafeError(`Supabase HTTP ${response.status}.`); }
    if (id) { await response.body?.cancel(); return []; }
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new SafeError('Invalid Supabase response.');
    return records(rows);
  }
  latest() { return this.query('select=id,ping_time,status&order=ping_time.desc,id.desc&limit=4'); }
  async find(id: string) { return (await this.query(`select=id,ping_time,status&request_id=eq.${id}&limit=1`))[0]; }
  async insert(id: string) { await this.query('on_conflict=request_id', id); }
  async close() {}
}

interface OrdsItem { errorCode?: unknown; resultSet?: { items?: Row[] } }
export class Oracle implements Driver {
  private config: Extract<DatabaseConfig, { type: 'oracle' }>;
  constructor(config: Extract<DatabaseConfig, { type: 'oracle' }>) { this.config = config; }
  private async sql(statement: string): Promise<Checkin[]> {
    const endpoint = this.config.url.endsWith('/_/sql') ? this.config.url : `${this.config.url}/_/sql`;
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64')}` },
      body: JSON.stringify({ statementText: statement }), signal: AbortSignal.timeout(12_000), redirect: 'manual',
    });
    if (!response.ok) { await response.body?.cancel(); throw new SafeError(`Oracle HTTP ${response.status}.`); }
    const result = await response.json() as { items?: OrdsItem[] };
    if (!Array.isArray(result.items) || result.items.length === 0) throw new SafeError('Invalid ORDS response.');
    for (const item of result.items) {
      if (item.errorCode != null && String(item.errorCode) !== '0') {
        // Never return upstream SQL, URLs or credentials in error details.
        const code = /^-?\d+$/.test(String(item.errorCode)) ? String(item.errorCode) : 'unknown';
        throw new SafeError(`Oracle SQL error ${code}.`);
      }
    }
    return records(result.items.flatMap(item => item.resultSet?.items ?? []));
  }
  private select = `SELECT id, TO_CHAR(ping_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS ping_time, status FROM keepalive_log`;
  latest() { return this.sql(`${this.select} ORDER BY keepalive_log.ping_time DESC, id DESC FETCH FIRST 4 ROWS ONLY`); }
  async find(id: string) { return (await this.sql(`${this.select} WHERE request_id = '${id}'`))[0]; }
  async insert(id: string) {
    await this.sql(`BEGIN BEGIN INSERT INTO keepalive_log (request_id, status) VALUES ('${id}', 'SUCCESS'); EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; END; COMMIT; END;`);
  }
  async close() {}
}

export class MySQL implements Driver {
  private connection: Pick<Connection, 'query' | 'end' | 'destroy'>;
  constructor(connection: Pick<Connection, 'query' | 'end' | 'destroy'>) { this.connection = connection; }
  private async query(sql: string, values: string[] = []): Promise<Checkin[]> {
    const [rows] = await this.connection.query<RowDataPacket[]>({ sql, values, timeout: 12_000 });
    return records(rows as Row[]);
  }
  private select = `SELECT CAST(id AS CHAR) AS id, DATE_FORMAT(ping_time, '%Y-%m-%dT%H:%i:%s.%fZ') AS ping_time, status FROM keepalive_logs`;
  latest() { return this.query(`${this.select} ORDER BY keepalive_logs.ping_time DESC, keepalive_logs.id DESC LIMIT 4`); }
  async find(id: string) { return (await this.query(`${this.select} WHERE request_id = ? LIMIT 1`, [id]))[0]; }
  async insert(id: string) {
    try {
      await this.connection.query({ sql: "INSERT INTO keepalive_logs (request_id, ping_time, status) VALUES (?, UTC_TIMESTAMP(6), 'SUCCESS')", values: [id], timeout: 12_000 });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'errno' in error && error.errno === 1062)) throw error;
    }
  }
  async close() { try { await this.connection.end(); } catch { this.connection.destroy(); } }
}

export async function openDriver(config: DatabaseConfig, env: object): Promise<Driver> {
  if (config.type === 'supabase') return new Supabase(config);
  if (config.type === 'oracle') return new Oracle(config);
  const binding: unknown = Reflect.get(env, config.binding);
  if (!binding || typeof binding !== 'object' || !('connectionString' in binding) || !('host' in binding)) {
    throw new SafeError(`Missing Hyperdrive binding ${config.binding}.`);
  }
  const hd = binding as Hyperdrive;
  return new MySQL(await createConnection({ host: hd.host, port: hd.port, user: hd.user, password: hd.password, database: hd.database, disableEval: true, connectTimeout: 12_000, timezone: 'Z' }));
}

export async function checkin(driver: Driver, id: string): Promise<Checkin> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new SafeError('Invalid request ID.');
  const existing = await driver.find(id);
  if (existing?.status === 'SUCCESS') return existing;
  await driver.insert(id);
  const receipt = await driver.find(id);
  if (receipt?.status !== 'SUCCESS') throw new SafeError('Write receipt not found; retry with the same request ID.');
  return receipt;
}
