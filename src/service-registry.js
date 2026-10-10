import { MAX_PAGE, PAGE_SIZE, SERVICES } from "./config.js";
import { missingServiceEnv } from "./env.js";
import { getRandomGeo } from "./geo.js";
import { parseBoundedInt } from "./http.js";

const failure = (env, service) => ({
  ok: false,
  error: "configuration_error",
  missing: missingServiceEnv(env, service, "query"),
  rows: [], count: 0, page: 1, limit: PAGE_SIZE, totalPages: 1
});

export async function runService(service, env, geo = getRandomGeo(), requestId) {
  if (!env.backends?.[service]) return false;
  return env.backends[service].ping(geo, requestId);
}

export async function queryService(env, service, page) {
  if (!env.backends?.[service]) return failure(env, service);
  return env.backends[service].query(page);
}

export async function getStats(env, pages = {}) {
  const aliases = {
    supabase: pages.supabase || pages.sb_p,
    adb_us: pages.adb_us || pages.us_p,
    adb_jp: pages.adb_jp || pages.jp_p,
    db2: pages.db2 || pages.db2_p,
    mysql_jp: pages.mysql_jp || pages.mysql_jp_p,
  };
  const query = (service, value) => queryService(
    env,
    service,
    parseBoundedInt(value || pages.page, 1, 1, MAX_PAGE)
  ).then(result => [service, result]);
  return Object.fromEntries(await Promise.all(SERVICES.map(service => query(service, aliases[service]))));
}
