import { randomUUID } from 'node:crypto';
import { confirmedRow, GEO_FIELDS } from './receipt.js';
import { MAX_PAGE, PAGE_SIZE } from '../config/constants.js';
import { fetchWithTimeout, publicErrorCode } from '../shared/http.js';
import { parseBoundedInt } from '../shared/values.js';
import { getRandomGeo } from '../geo/resolve.js';

function credentials(user, pass) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

export function sqlSucceeded(body) {
  return Array.isArray(body?.items) && body.items.length > 0
    && body.items.every(item => !item.errorDetails && !item.errorCode
      && !item.error && item.statementId !== undefined);
}

function queryRows(body) {
  const rows = body?.items?.[0]?.resultSet?.items;
  if (!sqlSucceeded(body) || body.items.length !== 1 || !Array.isArray(rows))
    throw new Error('invalid_sql_result');
  return rows;
}

async function execute(base, user, pass, statementText) {
  const response = await fetchWithTimeout(`${base}/_/sql`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: credentials(user, pass), 'Content-Type': 'application/json' },
    body: JSON.stringify({ statementText })
  });
  if (!response.ok) throw new Error('upstream_error');
  const body = await response.json();
  if (!sqlSucceeded(body)) throw new Error('sql_error');
  return body;
}

export async function pingOracle(ordsBase, user, pass, geo = getRandomGeo(), requestId = randomUUID()) {
  try {
    const literal = value => `'${String(value ?? '').replaceAll("'", "''")}'`;
    const id = literal(requestId);
    const values = GEO_FIELDS.map(field => literal(geo[field])).join(',');
    await execute(ordsBase, user, pass, `BEGIN
      INSERT INTO keepalive_log (request_id,status,colo,country,city,region,ip)
      VALUES (${id},'SUCCESS',${values});
      EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;
    END;`);
    // A separate ORDS session verifies that the insert (or racing winner) committed.
    const receipt = await execute(ordsBase, user, pass,
      `SELECT request_id,status,colo,country,city,region,ip FROM keepalive_log WHERE request_id=${id}`);
    return confirmedRow(queryRows(receipt), requestId, geo);
  } catch { return false; }
}

export async function queryOracle(ordsBase, user, pass, page = 1, limit = PAGE_SIZE) {
  const p = parseBoundedInt(page, 1, 1, MAX_PAGE);
  const l = parseBoundedInt(limit, PAGE_SIZE, 1, 100);
  try {
    const offset = (p - 1) * l;
    const [rowsData, countData] = await Promise.all([
      execute(ordsBase, user, pass, `SELECT id, ping_time, status, colo, country, city, region, ip FROM keepalive_log ORDER BY ping_time DESC, id DESC OFFSET ${offset} ROWS FETCH NEXT ${l} ROWS ONLY`),
      execute(ordsBase, user, pass, 'SELECT COUNT(*) AS cnt FROM keepalive_log')
    ]);
    const rows = queryRows(rowsData);
    const counts = queryRows(countData);
    const count = Number(counts[0]?.cnt);
    if (counts.length !== 1 || counts[0].cnt == null || !Number.isSafeInteger(count) || count < 0)
      throw new Error('invalid_sql_count');
    return { ok: true, rows, count, page: p, limit: l, totalPages: Math.max(1, Math.ceil(count / l)) };
  } catch (error) {
    return { ok: false, error: publicErrorCode(error), rows: [], count: 0, page: p, limit: l, totalPages: 1 };
  }
}

export async function cleanOracle(ordsBase, user, pass, action) {
  try {
    const sql = action === "delete"
      ? "DELETE FROM keepalive_log WHERE city = 'Edge' OR (colo = 'SIN' AND country = 'US')"
      : "BEGIN UPDATE keepalive_log SET city = 'Salt Lake City', region = 'Utah' WHERE colo = 'SLC' AND city = 'Edge'; UPDATE keepalive_log SET country = 'SG' WHERE colo = 'SIN' AND country = 'US'; COMMIT; END;";
    await execute(ordsBase, user, pass, sql);
    return { action, ok: true, status: 200 };
  } catch (error) {
    return { action, ok: false, error: publicErrorCode(error) };
  }
}
