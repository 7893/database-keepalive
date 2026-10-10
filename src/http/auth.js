import { createHash, timingSafeEqual } from 'node:crypto';
import { errorResponse } from './responses.js';

export async function verifyAdminRequest(request, env) {
  const expected = env.TRIGGER_SECRET;
  if (!expected) {
    return { ok: false, response: errorResponse(503, "admin_auth_not_configured", "Administrative routes are disabled.") };
  }

  const authorization = request.headers.get("authorization") || "";
  const hasBearer = authorization.startsWith("Bearer ");
  const provided = hasBearer ? authorization.slice(7) : "";
  const matches = constantTimeEqual(provided, expected);

  if (!hasBearer || !provided || !matches) {
    return { ok: false, response: errorResponse(401, "unauthorized", "A valid Bearer token is required.") };
  }
  return { ok: true };
}

export function constantTimeEqual(value, expected) {
  if (!value || !expected) return false;
  const hash = text => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(value), hash(expected));
}
