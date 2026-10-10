import { ADMIN_ACTIONS, MAX_PAGE, SERVICES, SERVICE_SET, TRIGGER_MODES } from "./config.js";
import { verifyAdminRequest } from "./auth.js";
import { cleanServices } from "./admin.js";
import { missingServiceEnv } from "./env.js";
import { getDistinctRandomGeos, getRealWorkerTrace, getRequestGeo } from "./geo.js";
import { errorResponse, HTML_HEADERS, jsonResponse, methodNotAllowed, parseBoundedInt } from "./http.js";
import { publicQueryResult, publicStats } from "./privacy.js";
import { getStats, queryService, runService } from "./service-registry.js";
import { renderHTML } from "./ui/page.js";

async function authorize(request, env) {
  const result = await verifyAdminRequest(request, env);
  return result.ok ? null : result.response;
}

async function handleData(request, env, searchParams) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const service = searchParams.get("service");
  if (!SERVICE_SET.has(service)) {
    return errorResponse(400, "invalid_service", `service must be one of: ${SERVICES.join(", ")}`);
  }
  const page = parseBoundedInt(searchParams.get("page"), 1, 1, MAX_PAGE);
  const result = await queryService(env, service, page);
  const status = result.ok ? 200 : (result.error === "configuration_error" ? 503 : 502);
  return jsonResponse(publicQueryResult(result, env.SHOW_FULL_IP === "true"), status);
}

async function handleDebug(request, env, searchParams) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const denied = await authorize(request, env);
  if (denied) return denied;
  return jsonResponse(await getStats(env, Object.fromEntries(searchParams.entries())));
}

async function handleClean(request, env, searchParams) {
  if (request.method !== "POST" && request.method !== "DELETE") return methodNotAllowed(["POST", "DELETE"]);
  const denied = await authorize(request, env);
  if (denied) return denied;

  const action = searchParams.get("action");
  if (!ADMIN_ACTIONS.has(action)) {
    return errorResponse(400, "invalid_action", `action must be one of: ${[...ADMIN_ACTIONS].join(", ")}`);
  }
  if ((action === "delete" && request.method !== "DELETE") || (action === "repair" && request.method !== "POST")) {
    return errorResponse(400, "method_action_mismatch", "Use POST for repair and DELETE for delete.");
  }

  const result = await cleanServices(env, action);
  if (result.error === "configuration_error") return jsonResponse(result, 503);
  return jsonResponse(result, result.success ? 200 : 502);
}

async function handleTrigger(request, env, searchParams, origin) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const denied = await authorize(request, env);
  if (denied) return denied;

  const target = searchParams.get("target") || "all";
  if (target !== "all" && !SERVICE_SET.has(target)) {
    return errorResponse(400, "invalid_target", `target must be all or one of: ${SERVICES.join(", ")}`);
  }
  const targets = target === "all" ? SERVICES : [target];
  const requestedMode = searchParams.get("mode") || "simulated";
  const mode = requestedMode === "random" ? "simulated" : requestedMode;
  if (!TRIGGER_MODES.has(mode)) {
    return errorResponse(400, "invalid_mode", `mode must be one of: ${[...TRIGGER_MODES].join(", ")}`);
  }

  const missing = [...new Set(targets.flatMap(service => missingServiceEnv(env, service, "ping")))];
  if (missing.length) return jsonResponse({ success: false, error: "configuration_error", missing }, 503);

  const simulated = getDistinctRandomGeos(targets.length);
  const real = mode === "real" ? await getRealWorkerTrace() : null;
  const client = mode === "client" ? getRequestGeo(request) : null;
  const entries = await Promise.all(targets.map(async (service, index) => {
    const geo = mode === "real" ? real : (mode === "client" ? client : simulated[index]);
    return [service, await runService(service, env, geo)];
  }));
  const results = Object.fromEntries(entries);
  const success = Object.values(results).every(Boolean);

  if (request.headers.get("accept")?.includes("text/html")) {
    return new Response(null, { status: 303, headers: { "location": origin, "cache-control": "no-store" } });
  }
  return jsonResponse({ success, results }, success ? 200 : 502);
}

async function handlePage(request, env, searchParams) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
  const pages = {
    supabase: searchParams.get("supabase_p") || searchParams.get("sb_p") || searchParams.get("page"),
    adb_us: searchParams.get("adb_us_p") || searchParams.get("us_p") || searchParams.get("page"),
    adb_jp: searchParams.get("adb_jp_p") || searchParams.get("jp_p") || searchParams.get("page"),
    db2: searchParams.get("db2_p") || searchParams.get("page"),
    mysql_jp: searchParams.get("mysql_jp_p") || searchParams.get("page"),
  };
  const stats = publicStats(await getStats(env, pages), env.SHOW_FULL_IP === "true");
  return new Response(request.method === "HEAD" ? null : renderHTML(stats), { headers: HTML_HEADERS });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  if (pathname === "/api/data") return handleData(request, env, searchParams);
  if (pathname === "/debug") return handleDebug(request, env, searchParams);
  if (pathname === "/admin/clean" || pathname === "/api/clean") return handleClean(request, env, searchParams);
  if (pathname === "/trigger") return handleTrigger(request, env, searchParams, url.origin);
  if (pathname === "/") return handlePage(request, env, searchParams);
  return errorResponse(404, "not_found", "Route not found.");
}
