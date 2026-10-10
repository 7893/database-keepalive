const PUBLIC_ENV = {};
import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/router.js";
import { ADMIN_ENV, authorized, FULL_ENV, request, withMockedFetch } from "./helpers.js";

test("router returns stable errors without contacting unconfigured services", async () => {
  let fetchCalls = 0;
  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error("unexpected fetch");
  }, async () => {
    const missingData = await handleRequest(request("/api/data?service=supabase"), PUBLIC_ENV, {});
    assert.equal(missingData.status, 503);
    assert.deepEqual((await missingData.json()).missing, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);

    const missingTrigger = await handleRequest(
      request("/trigger?target=supabase", authorized()),
      ADMIN_ENV,
      {}
    );
    assert.equal(missingTrigger.status, 503);

    const missingClean = await handleRequest(
      request("/admin/clean?action=repair", authorized()),
      ADMIN_ENV,
      {}
    );
    assert.equal(missingClean.status, 503);

    const head = await handleRequest(request("/", { method: "HEAD" }), PUBLIC_ENV, {});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const notFound = await handleRequest(request("/missing"), {}, {});
    assert.equal(notFound.status, 404);
    assert.equal(fetchCalls, 0);
  });
});

test("authorized debug output reports per-service configuration failures", async () => {
  const response = await handleRequest(
    request("/debug", { headers: authorized().headers }),
    ADMIN_ENV,
    {}
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body), ["supabase", "adb_us", "adb_jp", "db2", "mysql_jp"]);
  assert.ok(Object.values(body).every(result => result.error === "configuration_error"));
});
