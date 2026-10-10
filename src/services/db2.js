import { MAX_PAGE, PAGE_SIZE } from "../config.js";
import { fetchWithTimeout, logError, parseBoundedInt, publicErrorCode } from "../http.js";
import { getRandomGeo } from "../geo.js";

function bridgeUrl(env, path) {
  const base = new URL(env.DB2_BRIDGE_URL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("invalid_bridge_url");
  }
  return new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base.origin);
}

async function bridge(env, path, init = {}) {
  const response = await fetchWithTimeout(bridgeUrl(env, path).toString(), {
    ...init,
    // Workers supports manual/follow; reject 3xx below without forwarding auth.
    redirect: "manual",
    headers: {
      "Authorization": `Bearer ${env.DB2_BRIDGE_TOKEN}`,
      "Content-Type": "application/json"
    }
  }, 20_000);
  if (!response.ok) {
    logError("db2_bridge_http_error", { status: response.status });
    throw new Error("upstream_error");
  }
  const body = await response.json();
  if (body.ok !== true) throw new Error("upstream_error");
  return body;
}

export async function pingDb2(env, geo = getRandomGeo()) {
  try {
    const requestId = crypto.randomUUID();
    const result = await bridge(env, "/v1/checkins", {
      method: "POST",
      body: JSON.stringify({ ...geo, request_id: requestId })
    });
    return result.committed === true && result.request_id === requestId
      && Number.isSafeInteger(result.row?.id) && result.row.id > 0
      && result.row.status === "SUCCESS" && Number.isFinite(Date.parse(result.row.ping_time));
  } catch (error) {
    logError("service_ping_failed", { service: "db2", error: publicErrorCode(error) });
    return false;
  }
}

export async function queryDb2(env, page = 1, limit = PAGE_SIZE) {
  const p = parseBoundedInt(page, 1, 1, MAX_PAGE);
  const l = parseBoundedInt(limit, PAGE_SIZE, 1, 100);
  try {
    const result = await bridge(env, `/v1/checkins?page=${p}&limit=${l}`);
    if (!Array.isArray(result.rows) || result.rows.length > l
      || !Number.isSafeInteger(result.count) || result.count < 0
      || result.page !== p || result.limit !== l) throw new Error("upstream_error");
    return {
      ok: true, rows: result.rows, count: result.count, page: p, limit: l,
      totalPages: Math.max(1, Math.ceil(result.count / l))
    };
  } catch (error) {
    logError("service_query_failed", { service: "db2", error: publicErrorCode(error), kind: error?.name });
    return { ok: false, error: publicErrorCode(error), rows: [], count: 0, page: p, limit: l, totalPages: 1 };
  }
}
