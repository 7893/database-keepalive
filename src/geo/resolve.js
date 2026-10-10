import { isIP } from 'node:net';
import { randomInteger } from './random.js';
import { GLOBAL_POPS } from './locations.js';
import { fetchWithTimeout, logError, publicErrorCode } from '../shared/http.js';

function generatePopIp(pop, integer) {
  if (pop?.subnets?.length) {
    const subnet = pop.subnets[integer(0, pop.subnets.length - 1)];
    return `${subnet}.${integer(2, 253)}`;
  }
  return `104.28.${integer(2, 252)}.${integer(2, 252)}`;
}

export function getDistinctRandomGeos(count = 1, integer = randomInteger) {
  if (!Number.isInteger(count) || count < 0 || count > GLOBAL_POPS.length)
    throw new RangeError('invalid_geo_count');
  const pool = [...GLOBAL_POPS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = integer(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map(pop => ({
    colo: pop.colo,
    country: pop.country,
    city: pop.city,
    region: pop.region,
    ip: generatePopIp(pop, integer)
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
    let ip = "", colo = "", loc = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("ip=")) ip = line.substring(3).trim();
      if (line.startsWith("colo=")) colo = line.substring(5).trim();
      if (line.startsWith("loc=")) loc = line.substring(4).trim();
    }
    if (!isIP(ip) || ip === '127.0.0.1' || !/^[A-Z0-9]{3}$/.test(colo) || !/^[A-Z]{2}$/.test(loc))
      throw new Error('invalid_trace');
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
    throw new Error('real_geo_unavailable');
  }
}

export function getRequestGeo(request) {
  const cf = request?.cf;
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip');
  if (!cf?.colo || !isIP(ip || '') || !/^[A-Z]{2}$/.test(cf.country || ''))
    throw new Error('client_geo_unavailable');
  return {
    colo: cf.colo || "CFE",
    country: cf.country || "XX",
    city: cf.city || "Edge",
    region: cf.region || "",
    ip
  };
}
