import { GLOBAL_POPS } from "./config.js";
import { fetchWithTimeout, logError, publicErrorCode } from "./http.js";

function secureRandomInt(min, max) {
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

function generatePopIp(pop) {
  if (pop?.subnets?.length) {
    const subnet = pop.subnets[secureRandomInt(0, pop.subnets.length - 1)];
    return `${subnet}.${secureRandomInt(2, 253)}`;
  }
  return `104.28.${secureRandomInt(2, 252)}.${secureRandomInt(2, 252)}`;
}

export function getDistinctRandomGeos(count = 1) {
  const pool = [...GLOBAL_POPS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map(pop => ({
    colo: pop.colo,
    country: pop.country,
    city: pop.city,
    region: pop.region,
    ip: generatePopIp(pop)
  }));
}

export function getRandomGeo() {
  return getDistinctRandomGeos(1)[0];
}

export async function getRealWorkerTrace() {
  try {
    const response = await fetchWithTimeout("https://1.1.1.1/cdn-cgi/trace");
    if (!response.ok) throw new Error("upstream_error");
    const text = await response.text();
    let ip = "127.0.0.1", colo = "CFE", loc = "XX";
    for (const line of text.split("\n")) {
      if (line.startsWith("ip=")) ip = line.substring(3).trim();
      if (line.startsWith("colo=")) colo = line.substring(5).trim();
      if (line.startsWith("loc=")) loc = line.substring(4).trim();
    }
    const pop = GLOBAL_POPS.find(item => item.colo === colo);
    return {
      ip,
      colo,
      country: pop ? pop.country : (loc || "XX"),
      city: pop ? pop.city : (colo === "CFE" ? "Edge" : colo),
      region: pop ? pop.region : (loc || "Edge")
    };
  } catch (error) {
    logError("worker_trace_failed", { error: publicErrorCode(error) });
    return getRandomGeo();
  }
}

export function getRequestGeo(request) {
  const cf = request?.cf;
  if (!cf?.colo) return getRandomGeo();
  return {
    colo: cf.colo || "CFE",
    country: cf.country || "XX",
    city: cf.city || "Edge",
    region: cf.region || "",
    ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "127.0.0.1"
  };
}
