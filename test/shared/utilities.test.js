import test from "node:test";
import assert from "node:assert/strict";
import { missingEnv, missingServiceEnv, serviceEnvNames } from '../../src/config/env.js';
import { escapeHtml, parseBoundedInt } from '../../src/shared/values.js';
import { fetchWithTimeout } from '../../src/shared/http.js';
import { publicIp, publicQueryResult } from '../../src/shared/privacy.js';
import { withMockedFetch } from '../helpers.js';

test("environment requirements reflect each service operation", () => {
  assert.deepEqual(serviceEnvNames("supabase"), [
    "SUPABASE_URL", "SUPABASE_SECRET_KEY"
  ]);
  assert.ok(serviceEnvNames("db2").includes("DB2_JDBC_JAR"));
  assert.ok(serviceEnvNames("mysql_jp").includes("MYSQL_SSL_CA"));
  assert.deepEqual(missingEnv({ PRESENT: "yes" }, ["PRESENT", "MISSING"]), ["MISSING"]);
  assert.deepEqual(missingServiceEnv({}, "db2"), serviceEnvNames("db2"));
  const env = Object.fromEntries(serviceEnvNames("db2").map(key => [key, "test-value"]));
  assert.deepEqual(missingServiceEnv(env, "db2"), []);
});

test("input and output helpers clamp, escape, and mask values", () => {
  assert.equal(parseBoundedInt("5", 1, 1, 10), 5);
  assert.equal(parseBoundedInt("999", 1, 1, 10), 10);
  assert.equal(parseBoundedInt("not-a-number", 3, 1, 10), 3);
  assert.equal(escapeHtml(`<a href="x">O'Reilly & Co</a>`), "&lt;a href=&quot;x&quot;&gt;O&#39;Reilly &amp; Co&lt;/a&gt;");
  assert.equal(publicIp("203.0.113.42"), "203.0.113.xxx");
  assert.equal(publicIp("2001:db8:abcd:12::1"), "2001:db8:abcd::");
  assert.equal(publicIp("203.0.113.42", true), "203.0.113.42");
  assert.equal(publicIp("invalid"), "—");

  const result = publicQueryResult({ rows: [{ id: 1, ip: "198.51.100.9" }] });
  assert.equal(result.rows[0].ip, "198.51.100.xxx");
});

test("fetch timeout becomes a stable public error", async () => {
  await withMockedFetch((_input, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), async () => {
    await assert.rejects(fetchWithTimeout("https://upstream.test", {}, 1), /upstream_timeout/);
  });
});
