import { randomUUID } from 'node:crypto';
import { constantTimeEqual } from '../src/auth.js';
import { handleRequest } from '../src/router.js';
import { SERVICES } from '../src/config.js';
import { runService } from '../src/service-registry.js';
import { metadata } from '../src/checkin-metadata.js';
import { jsonResponse, errorResponse } from '../src/http.js';

export async function scheduled(env, execution, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const results = Object.fromEntries(await Promise.all(SERVICES.map(async service => {
    const { geo, requestId } = metadata(execution, service);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt) await delay(attempt * 1000);
      try { ok = await runService(service, env, geo, requestId); } catch {}
    }
    console.log(JSON.stringify({ service, ok, execution }));
    return [service, ok];
  })));
  const success = Object.values(results).every(Boolean);
  return jsonResponse({ success, results }, success ? 200 : 502);
}

export async function handle(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/internal/checkin') {
    if (!constantTimeEqual(request.headers.get('x-keepalive-scheduler'), env.SCHEDULER_TOKEN))
      return errorResponse(401, 'unauthorized', 'Unauthorized');
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST');
    const stamp = request.headers.get('x-cloudscheduler-scheduletime');
    const name = request.headers.get('x-cloudscheduler-jobname');
    const execution = stamp && name ? `${name}:${stamp}`.slice(0, 256) : randomUUID();
    return scheduled(env, execution);
  }
  return handleRequest(request, env);
}
