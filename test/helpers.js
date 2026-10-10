import { timingSafeEqual } from "node:crypto";

// Cloudflare exposes this Web Crypto extension; Node needs a small test shim.
if (!globalThis.crypto.subtle.timingSafeEqual) {
  globalThis.crypto.subtle.timingSafeEqual = (left, right) => (
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export const ADMIN_ENV = { TRIGGER_SECRET: "test-admin-secret" };

export const FULL_ENV = {
  ...ADMIN_ENV,
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SECRET_KEY: "test-supabase-key",
  OCI_ADB_US_URL: "https://adb-us.test",
  OCI_ADB_US_USER: "test-user",
  OCI_ADB_US_PASS: "test-pass",
  OCI_ADB_JP_URL: "https://adb-jp.test",
  OCI_ADB_JP_USER: "test-user",
  OCI_ADB_JP_PASS: "test-pass",
  DB2_BRIDGE_URL: "https://db2-bridge.test",
  DB2_BRIDGE_TOKEN: "test-bridge-token",
  MYSQL_JP_BRIDGE_URL: "https://mysql-jp-bridge.test",
  MYSQL_JP_BRIDGE_TOKEN: "test-jp-mysql-token",
};

export function request(path, init = {}) {
  return new Request(`https://keepalive.test${path}`, init);
}

export function authorized(method = "POST") {
  return {
    method,
    headers: { Authorization: `Bearer ${ADMIN_ENV.TRIGGER_SECRET}` }
  };
}

export async function withMockedFetch(mock, action) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
