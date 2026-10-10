export const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

export const HTML_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

export function errorResponse(status, code, message, extraHeaders = {}) {
  return jsonResponse({ success: false, error: code, message }, status, extraHeaders);
}

export function methodNotAllowed(allowed) {
  return jsonResponse(
    { success: false, error: "method_not_allowed", message: `Use ${allowed.join(" or ")}.` },
    405,
    { "allow": allowed.join(", ") }
  );
}
