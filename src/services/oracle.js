import { MAX_PAGE, PAGE_SIZE } from "../config.js";
import { fetchWithTimeout, logError, parseBoundedInt, publicErrorCode } from "../http.js";
import { getRandomGeo } from "../geo.js";

function credentials(user, pass) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

export function sqlSucceeded(body) {
  return Array.isArray(body?.items) && body.items.length > 0
    && body.items.every(item => !item.errorDetails && !item.errorCode
      && !item.error && item.statementId !== undefined);
}

export async function pingOracle(ordsBase, user, pass, geo = getRandomGeo()) {
  try {
    const authorization = credentials(user, pass);
    const field = v => String(v || '').replaceAll("'", "''");
    const statementText = `INSERT INTO keepalive_log (status,colo,country,city,region,ip) VALUES ('SUCCESS',${['colo','country','city','region','ip'].map(k => `'${field(geo[k])}'`).join(',')})`;
    const response = await fetchWithTimeout(`${ordsBase}/_/sql`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ statementText })
    });
    if (!response.ok) return false;
    const body = await response.json();
    return sqlSucceeded(body) && body.items.some(item => item.statementType === 'dml' && item.result === 1);
  } catch { return false; }
}

export async function queryOracle(ordsBase, user, pass, page = 1, limit = PAGE_SIZE) {
  const p = parseBoundedInt(page, 1, 1, MAX_PAGE);
  const l = parseBoundedInt(limit, PAGE_SIZE, 1, 100);
  try {
    const headers = { "Authorization": credentials(user, pass), "Content-Type": "application/json" };
    const offset = (p - 1) * l;
    const [rowsResponse, countResponse] = await Promise.all([
      fetchWithTimeout(`${ordsBase}/_/sql`, {
        method: "POST", headers,
        body: JSON.stringify({ statementText: `SELECT id, ping_time, status, colo, country, city, region, ip FROM keepalive_log ORDER BY ping_time DESC OFFSET ${offset} ROWS FETCH NEXT ${l} ROWS ONLY` })
      }),
      fetchWithTimeout(`${ordsBase}/_/sql`, {
        method: "POST", headers,
        body: JSON.stringify({ statementText: "SELECT COUNT(*) AS cnt FROM keepalive_log" })
      })
    ]);
    if (!rowsResponse.ok || !countResponse.ok) throw new Error("upstream_error");
    const rowsData = await rowsResponse.json();
    const countData = await countResponse.json();
    const rows = rowsData?.items?.[0]?.resultSet?.items || [];
    const count = Number(countData?.items?.[0]?.resultSet?.items?.[0]?.cnt) || 0;
    return { ok: true, rows, count, page: p, limit: l, totalPages: Math.max(1, Math.ceil(count / l)) };
  } catch (error) {
    return { ok: false, error: publicErrorCode(error), rows: [], count: 0, page: p, limit: l, totalPages: 1 };
  }
}

export async function cleanOracle(ordsBase, user, pass, action) {
  try {
    const headers = { "Authorization": credentials(user, pass), "Content-Type": "application/sql" };
    const sql = action === "delete"
      ? "DELETE FROM keepalive_log WHERE city = 'Edge' OR (colo = 'SIN' AND country = 'US')"
      : "BEGIN UPDATE keepalive_log SET city = 'Salt Lake City', region = 'Utah' WHERE colo = 'SLC' AND city = 'Edge'; UPDATE keepalive_log SET country = 'SG' WHERE colo = 'SIN' AND country = 'US'; COMMIT; END;";
    const response = await fetchWithTimeout(`${ordsBase}/_/sql`, { method: "POST", headers, body: sql });
    return { action, ok: response.ok, status: response.status };
  } catch (error) {
    return { action, ok: false, error: publicErrorCode(error) };
  }
}
