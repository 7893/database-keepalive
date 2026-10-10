import { MAX_PAGE, PAGE_SIZE } from '../config/constants.js';
import { fetchWithTimeout, logError, publicErrorCode } from '../shared/http.js';
import { parseBoundedInt } from '../shared/values.js';
import { getRandomGeo } from '../geo/resolve.js';

export async function pingSupabase(env, geo = getRandomGeo()) {
  const key = env.SUPABASE_SECRET_KEY;
  try {
    const response = await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/my_keepalive_logs`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ status: "SUCCESS", ...geo })
    });
    return response.ok || response.status === 201;
  } catch (error) {
    logError("service_ping_failed", { service: "supabase", error: publicErrorCode(error) });
    return false;
  }
}

export async function querySupabase(env, page = 1, limit = PAGE_SIZE) {
  const p = parseBoundedInt(page, 1, 1, MAX_PAGE);
  const l = parseBoundedInt(limit, PAGE_SIZE, 1, 100);
  try {
    const key = env.SUPABASE_SECRET_KEY;
    const offset = (p - 1) * l;
    const response = await fetchWithTimeout(
      `${env.SUPABASE_URL}/rest/v1/my_keepalive_logs?select=id,ping_time,status,colo,country,city,region,ip&order=ping_time.desc&limit=${l}&offset=${offset}`,
      { headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Prefer": "count=exact" } }
    );
    if (!response.ok) throw new Error("upstream_error");
    const rows = await response.json();
    const count = Number.parseInt((response.headers.get("content-range") || "").split("/")[1] || "0", 10) || 0;
    return { ok: true, rows: Array.isArray(rows) ? rows : [], count, page: p, limit: l, totalPages: Math.max(1, Math.ceil(count / l)) };
  } catch (error) {
    return { ok: false, error: publicErrorCode(error), rows: [], count: 0, page: p, limit: l, totalPages: 1 };
  }
}

export async function cleanSupabase(env, action) {
  try {
    const key = env.SUPABASE_SECRET_KEY;
    const headers = { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
    const operations = action === "delete"
      ? [
          fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/my_keepalive_logs?city=eq.Edge`, { method: "DELETE", headers }),
          fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/my_keepalive_logs?colo=eq.SIN&country=eq.US`, { method: "DELETE", headers })
        ]
      : [
          fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/my_keepalive_logs?colo=eq.SLC&city=eq.Edge`, {
            method: "PATCH", headers, body: JSON.stringify({ city: "Salt Lake City", region: "Utah" })
          }),
          fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/my_keepalive_logs?colo=eq.SIN&country=eq.US`, {
            method: "PATCH", headers, body: JSON.stringify({ country: "SG" })
          })
        ];
    const responses = await Promise.all(operations);
    return { action, ok: responses.every(response => response.ok), status: responses.map(response => response.status) };
  } catch (error) {
    return { action, ok: false, error: publicErrorCode(error) };
  }
}
