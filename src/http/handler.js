import { dueCheckins } from '../scheduling/plan.js';
import { randomUUID } from 'node:crypto';
import { constantTimeEqual } from './auth.js';
import { handleRequest } from './router.js';
import { SERVICES } from '../config/services.js';
import { runService } from '../db/registry.js';
import { metadata } from '../geo/metadata.js';
import { jsonResponse, errorResponse } from './responses.js';

export async function scheduled(env, execution, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), targets = SERVICES) {
  const results = Object.fromEntries(await Promise.all(targets.map(async service => {
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
  if (path === '/internal/checkin' || path === '/internal/tick') {
    if (!constantTimeEqual(request.headers.get('x-keepalive-scheduler'), env.SCHEDULER_TOKEN))
      return errorResponse(401, 'unauthorized', 'Unauthorized');
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST');
    const stamp = request.headers.get('x-cloudscheduler-scheduletime');
    const name = request.headers.get('x-cloudscheduler-jobname');
    if (path === '/internal/tick') {
      let due;
      try { due = dueCheckins(stamp); }
      catch { return errorResponse(400, 'invalid_schedule_time', 'A valid scheduler timestamp is required.'); }
      if (!due.length) return jsonResponse({ success: true, results: {} });
      const entry = due[0]; // The plan assigns distinct minutes across all services.
      console.log(JSON.stringify({ event: 'scheduled_checkin', ...entry }));
      return scheduled(env, entry.execution, undefined, [entry.service]);
    }
    const execution = stamp && name ? `${name}:${stamp}`.slice(0, 256) : randomUUID();
    return scheduled(env, execution);
  }
  return handleRequest(request, env);
}
