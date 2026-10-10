import test from "node:test";
import assert from "node:assert/strict";
import { pingMySQL, queryMySQL } from "../src/services/mysql.js";
import { publicCacheKey } from "../src/public-protection.js";
import { handleRequest } from "../src/router.js";
import { FULL_ENV, authorized, request, withMockedFetch } from "./helpers.js";

const GEO = { colo: "NRT", country: "JP", city: "Tokyo", region: "Kanto", ip: "203.0.113.7" };
const ROW = { id: 1, status: "SUCCESS", ping_time: "2026-10-10T01:23:00.000000Z", ...GEO };

for (const [service, prefix] of [["mysql_jp", "MYSQL_JP"]]) {
  test(`${service} routes authenticated writes and paginated reads to its own database bridge`, async () => {
    const calls = [];
    await withMockedFetch(async (input, init) => {
      const url = new URL(input);
      calls.push(url);
      assert.equal(url.origin, FULL_ENV[`${prefix}_BRIDGE_URL`]);
      assert.equal(url.pathname, "/v1/mysql/checkins");
      assert.equal(init.headers.Authorization, `Bearer ${FULL_ENV[`${prefix}_BRIDGE_TOKEN`]}`);
      assert.equal(init.redirect, "manual");
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.match(body.request_id, /^[a-f0-9-]{36}$/);
        assert.equal(body.city, GEO.city);
        return Response.json({ ok: true, committed: true, request_id: body.request_id, row: ROW });
      }
      assert.equal(url.searchParams.get("page"), "2");
      return Response.json({ ok: true, rows: [ROW], count: 11, page: 2, limit: 10 });
    }, async () => {
      assert.equal(await pingMySQL(FULL_ENV, service, GEO), true);
      assert.deepEqual(await queryMySQL(FULL_ENV, service, 2), {
        ok: true, rows: [ROW], count: 11, page: 2, limit: 10, totalPages: 2
      });
    });
    assert.equal(calls.length, 2);
  });
}

test("MySQL rejects uncommitted, mismatched and malformed success responses", async () => {
  for (const patch of [{ committed: false }, { request_id: "wrong" }, { row: { ...ROW, id: 0 } },
    { row: { ...ROW, ping_time: "invalid" } }, { row: { ...ROW, status: "FAILED" } }]) {
    await withMockedFetch(async (_url, init) => Response.json({
      ok: true, committed: true, request_id: JSON.parse(init.body).request_id, row: ROW, ...patch
    }), async () => assert.equal(await pingMySQL(FULL_ENV, "mysql_jp", GEO), false));
  }
  for (const patch of [{ count: -1 }, { page: 2 }, { rows: [{}] }, { rows: {}, count: 1 }]) {
    await withMockedFetch(async () => Response.json({
      ok: true, rows: [ROW], count: 1, page: 1, limit: 10, ...patch
    }), async () => assert.equal((await queryMySQL(FULL_ENV, "mysql_jp")).ok, false));
  }
});

test("MySQL credentials never follow redirects or insecure URLs", async () => {
  let calls = 0;
  await withMockedFetch(async (_url, init) => {
    calls++;
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://other.test" } });
  }, async () => {
    assert.equal(await pingMySQL(FULL_ENV, "mysql_jp", GEO), false);
    for (const url of ["http://bridge.test", "https://bridge.test?token=x", "https://bridge.test/#x"]) {
      assert.equal(await pingMySQL({ ...FULL_ENV, MYSQL_JP_BRIDGE_URL: url }, "mysql_jp", GEO), false);
    }
  });
  assert.equal(calls, 1);
});

test("MySQL trigger and public reads integrate with authentication, pagination and privacy", async () => {
  const env = { ...FULL_ENV, PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const writes = [];
  await withMockedFetch(async (input, init) => {
    assert.ok(String(input).startsWith(FULL_ENV.MYSQL_JP_BRIDGE_URL));
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body));
      return Response.json({ ok: true, committed: true, request_id: writes.at(-1).request_id, row: ROW });
    }
    return Response.json({ ok: true, rows: [ROW], count: 11, page: 2, limit: 10 });
  }, async () => {
    const denied = await handleRequest(request("/trigger?target=mysql_jp", { method: "POST" }), env, {});
    assert.equal(denied.status, 401);
    assert.equal(writes.length, 0);
    const trigger = await handleRequest(request("/trigger?target=mysql_jp", authorized()), env, {});
    assert.deepEqual(await trigger.json(), { success: true, results: { mysql_jp: true } });
    const data = await handleRequest(request("/api/data?service=mysql_jp&page=2"), env, {});
    assert.equal(data.status, 200);
    assert.equal((await data.json()).rows[0].ip, "203.0.113.xxx");
  });
  assert.equal(writes.length, 1);
});

test("Only Japan MySQL is shown and its pagination is independent", async () => {
  const env = { PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const page = await handleRequest(request("/"), env, {});
  const html = await page.text();
  assert.match(html, /card-mysql_jp/);
  assert.doesNotMatch(html, /card-mysql_us/);
  const jp = publicCacheKey(request("/?mysql_jp_p=2"));
  const us = publicCacheKey(request("/?mysql_us_p=2"));
  assert.notEqual(jp.url, us.url);
  assert.equal(new URL(jp.url).searchParams.get("mysql_jp_p"), "2");
  assert.equal(new URL(jp.url).searchParams.get("mysql_us_p"), null);
  assert.equal(us.url, publicCacheKey(request("/")).url);
});


test("US business MySQL cannot be queried or triggered", async () => {
  const env = { ...FULL_ENV, PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  await withMockedFetch(async () => { throw new Error("US MySQL must never be contacted"); }, async () => {
    const trigger = await handleRequest(request("/trigger?target=mysql_us", authorized()), env, {});
    assert.equal(trigger.status, 400);
    assert.equal((await trigger.json()).error, "invalid_target");
    const query = await handleRequest(request("/api/data?service=mysql_us"), env, {});
    assert.equal(query.status, 400);
    assert.equal((await query.json()).error, "invalid_service");
  });
});
