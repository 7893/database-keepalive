import { MAX_PAGE } from "./config.js";
import { errorResponse, logError, parseBoundedInt } from "./http.js";

export const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=60";
export const PUBLIC_RATE_LIMIT_SECONDS = 60;

const PUBLIC_PATHS = new Set(["/", "/api/data"]);
const encoder = new TextEncoder();

function isPublicRead(request, pathname) {
  return PUBLIC_PATHS.has(pathname) && (request.method === "GET" || request.method === "HEAD");
}

function selectedPage(searchParams, names) {
  const value = names.map(name => searchParams.get(name)).find(Boolean);
  return String(parseBoundedInt(value, 1, 1, MAX_PAGE));
}

export function publicCacheKey(request, showFullIp = false) {
  const source = new URL(request.url);
  const key = new URL(source.origin);
  key.pathname = source.pathname;

  if (source.pathname === "/api/data") {
    key.searchParams.set("service", source.searchParams.get("service") || "");
    key.searchParams.set("page", selectedPage(source.searchParams, ["page"]));
  } else {
    const pageFor = names => selectedPage(source.searchParams, [...names, "page"]);
    key.searchParams.set("supabase_p", pageFor(["supabase_p", "sb_p"]));
    key.searchParams.set("adb_us_p", pageFor(["adb_us_p", "us_p"]));
    key.searchParams.set("adb_jp_p", pageFor(["adb_jp_p", "jp_p"]));
    key.searchParams.set("db2_p", pageFor(["db2_p"]));
    key.searchParams.set("mysql_jp_p", pageFor(["mysql_jp_p"]));
  }

  key.searchParams.set("__keepalive_privacy", showFullIp ? "full" : "masked");
  return new Request(key.toString(), { method: "GET" });
}

async function rateLimitKey(request, pathname) {
  const clientAddress = request.headers.get("cf-connecting-ip") || "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${pathname}:${clientAddress}`));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function rateLimitResponse(request, env, pathname) {
  if (typeof env.PUBLIC_RATE_LIMITER?.limit !== "function") {
    return errorResponse(503, "protection_unavailable", "Public request protection is unavailable.");
  }

  try {
    const key = await rateLimitKey(request, pathname);
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key });
    if (success) return null;
    return errorResponse(429, "rate_limited", "Too many public requests. Try again shortly.", {
      "retry-after": String(PUBLIC_RATE_LIMIT_SECONDS)
    });
  } catch (error) {
    logError("public_rate_limit_error", { error: error instanceof Error ? error.message : "unknown_error" });
    return errorResponse(503, "protection_unavailable", "Public request protection is unavailable.");
  }
}

function withPublicCacheHeaders(response) {
  const cached = new Response(response.body, response);
  cached.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return cached;
}

async function readCache(cache, key) {
  try {
    return await cache.match(key);
  } catch (error) {
    logError("public_cache_read_error", { error: error instanceof Error ? error.message : "unknown_error" });
    return undefined;
  }
}

function writeCache(cache, key, response, ctx) {
  const write = cache.put(key, response).catch(error => {
    logError("public_cache_write_error", { error: error instanceof Error ? error.message : "unknown_error" });
  });
  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(write);
    return;
  }
  return write;
}

export async function protectPublicRequest(request, env, ctx, handler) {
  const { pathname } = new URL(request.url);
  if (!isPublicRead(request, pathname)) return handler();

  const limited = await rateLimitResponse(request, env, pathname);
  if (limited) return limited;

  const canUseCache = request.method === "GET" && globalThis.caches?.default;
  const key = canUseCache ? publicCacheKey(request, env.SHOW_FULL_IP === "true") : null;
  if (canUseCache) {
    const cached = await readCache(globalThis.caches.default, key);
    if (cached) return cached;
  }

  const response = await handler();
  if (response.status !== 200) return response;

  const cacheable = withPublicCacheHeaders(response);
  if (canUseCache) {
    await writeCache(globalThis.caches.default, key, cacheable.clone(), ctx);
  }
  return cacheable;
}
