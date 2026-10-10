import { MAX_PAGE, PAGE_SIZE } from "../config.js";
import { fetchWithTimeout, logError, parseBoundedInt, publicErrorCode } from "../http.js";
import { getRandomGeo } from "../geo.js";

function settings(env, service) {
  const prefix = { mysql_jp: "MYSQL_JP" }[service];
  if (!prefix) throw new Error("unsupported_service");
  const base = new URL(env[`${prefix}_BRIDGE_URL`]);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("invalid_bridge_url");
  }
  return { base, token: env[`${prefix}_BRIDGE_TOKEN`] };
}

async function bridge(env, service, query = "", init = {}) {
  const { base, token } = settings(env, service);
  const url = new URL(`${base.pathname.replace(/\/$/, "")}/v1/mysql/checkins${query}`, base.origin);
  const response = await fetchWithTimeout(url.toString(), {
    ...init,
    redirect: "manual",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  }, 20_000);
  if (!response.ok) throw new Error("upstream_error");
  const body = await response.json();
  if (body.ok !== true) throw new Error("upstream_error");
  return body;
}

function validRow(row) {
  return Number.isSafeInteger(row?.id) && row.id > 0
    && row.status === "SUCCESS" && typeof row.ping_time === "string"
    && Number.isFinite(Date.parse(row.ping_time));
}

export async function pingMySQL(env, service, geo = getRandomGeo(), requestId = crypto.randomUUID()) {
  try {
    const result = await bridge(env, service, "", {
      method: "POST", body: JSON.stringify({ ...geo, request_id: requestId })
    });
    return result.committed === true && result.request_id === requestId && validRow(result.row);
  } catch (error) {
    logError("service_ping_failed", { service, error: publicErrorCode(error) });
    return false;
  }
}

export async function queryMySQL(env, service, page = 1, limit = PAGE_SIZE) {
  const p = parseBoundedInt(page, 1, 1, MAX_PAGE);
  const l = parseBoundedInt(limit, PAGE_SIZE, 1, 100);
  try {
    const result = await bridge(env, service, `?page=${p}&limit=${l}`);
    if (!Array.isArray(result.rows) || result.rows.length > l || !result.rows.every(validRow)
      || !Number.isSafeInteger(result.count) || result.count < result.rows.length
      || result.page !== p || result.limit !== l) throw new Error("upstream_error");
    return {
      ok: true, rows: result.rows, count: result.count, page: p, limit: l,
      totalPages: Math.max(1, Math.ceil(result.count / l))
    };
  } catch (error) {
    logError("service_query_failed", { service, error: publicErrorCode(error) });
    return { ok: false, error: publicErrorCode(error), rows: [], count: 0, page: p, limit: l, totalPages: 1 };
  }
}
