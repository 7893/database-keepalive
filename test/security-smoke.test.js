const PUBLIC_ENV = { PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) } };
import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { ADMIN_ENV, authorized, request, withMockedFetch } from "./helpers.js";

const { handleRequest } = await import("../src/router.js");

test("administrative routes fail closed", async () => {
  const disabled = await handleRequest(request("/trigger", { method: "POST" }), {}, {});
  assert.equal(disabled.status, 503);

  const missing = await handleRequest(request("/trigger", { method: "POST" }), ADMIN_ENV, {});
  assert.equal(missing.status, 401);

  const wrong = await handleRequest(request("/trigger", {
    method: "POST",
    headers: { Authorization: "Bearer wrong" }
  }), ADMIN_ENV, {});
  assert.equal(wrong.status, 401);

  const valid = await handleRequest(request("/trigger?target=unknown", authorized()), ADMIN_ENV, {});
  assert.equal(valid.status, 400);
});

test("mutating routes reject GET and invalid actions", async () => {
  const cleanGet = await handleRequest(request("/admin/clean?action=delete"), ADMIN_ENV, {});
  assert.equal(cleanGet.status, 405);

  const triggerGet = await handleRequest(request("/trigger"), ADMIN_ENV, {});
  assert.equal(triggerGet.status, 405);

  const invalidAction = await handleRequest(
    request("/admin/clean?action=purge_tests", authorized()),
    ADMIN_ENV,
    {}
  );
  assert.equal(invalidAction.status, 400);

  const wrongMethod = await handleRequest(
    request("/admin/clean?action=delete", authorized("POST")),
    ADMIN_ENV,
    {}
  );
  assert.equal(wrongMethod.status, 400);
});

test("public API rejects unknown services without touching upstreams", async () => {
  let fetchCalls = 0;
  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error("unexpected fetch");
  }, async () => {
    const response = await handleRequest(request("/api/data?service=unknown"), PUBLIC_ENV, {});
    assert.equal(response.status, 400);
    assert.equal(fetchCalls, 0);
  });
});

test("public rendering escapes stored data and masks IP addresses", async () => {
  const maliciousRow = {
    id: 1,
    ping_time: "invalid<script>alert(1)</script>",
    status: "SUCCESS",
    colo: "SIN",
    country: "SG",
    city: "<img src=x onerror=alert(1)>",
    region: "Central",
    ip: "203.0.113.42"
  };
  const mockFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/_/sql")) {
      const isCount = String(init.body || "").includes("COUNT(*)");
      const items = isCount ? [{ cnt: 1 }] : [maliciousRow];
      return Response.json({ items: [{ resultSet: { items } }] });
    }
    return new Response(JSON.stringify([maliciousRow]), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/1" }
    });
  };

  const env = { ...PUBLIC_ENV,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SECRET_KEY: "supabase-test-key",
    OCI_ADB_US_URL: "https://adb-us.test",
    OCI_ADB_US_USER: "test-user",
    OCI_ADB_US_PASS: "test-pass",
    OCI_ADB_JP_URL: "https://adb-jp.test",
    OCI_ADB_JP_USER: "test-user",
    OCI_ADB_JP_PASS: "test-pass"
  };

  await withMockedFetch(mockFetch, async () => {
    const response = await handleRequest(request("/"), env, {});
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /203\.0\.113\.xxx/);
    assert.ok(!html.includes("203.0.113.42"));
    const scriptStart = html.indexOf("<script>");
    const scriptEnd = html.indexOf("</script>", scriptStart);
    assert.notEqual(scriptStart, -1);
    assert.notEqual(scriptEnd, -1);
    const browserScript = html.slice(scriptStart + "<script>".length, scriptEnd);
    assert.ok(browserScript);
    assert.doesNotThrow(() => new Script(browserScript));

    const apiResponse = await handleRequest(request("/api/data?service=supabase"), env, {});
    const apiBody = await apiResponse.json();
    assert.equal(apiResponse.status, 200);
    assert.equal(apiBody.rows[0].ip, "203.0.113.xxx");
  });
});

test("upstream failures return an error status instead of false success", async () => {
  await withMockedFetch(async () => new Response("failed", { status: 500 }), async () => {
    const env = { ...PUBLIC_ENV, SUPABASE_URL: "https://supabase.test", SUPABASE_SECRET_KEY: "key" };
    const response = await handleRequest(request("/api/data?service=supabase"), env, {});
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error, "upstream_error");
  });
});
