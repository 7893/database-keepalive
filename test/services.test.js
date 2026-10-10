import test from "node:test";
import assert from "node:assert/strict";
import { cleanSupabase, pingSupabase, querySupabase } from "../src/services/supabase.js";
import { cleanOracle, pingOracle, queryOracle } from "../src/services/oracle.js";
import { FULL_ENV, withMockedFetch } from "./helpers.js";

const GEO = {
  colo: "SIN",
  country: "SG",
  city: "O'Hare",
  region: "Central",
  ip: "203.0.113.42"
};

test("Supabase adapter writes, paginates, and repairs records", async () => {
  const calls = [];
  await withMockedFetch(async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("select=")) {
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "10-10/21" }
      });
    }
    return new Response(null, { status: init.method === "POST" ? 201 : 204 });
  }, async () => {
    assert.equal(await pingSupabase(FULL_ENV, GEO), true);
    const query = await querySupabase(FULL_ENV, 2, 10);
    assert.equal(query.ok, true);
    assert.equal(query.count, 21);
    assert.equal(query.totalPages, 3);
    assert.match(calls[1].url, /limit=10&offset=10/);

    const repair = await cleanSupabase(FULL_ENV, "repair");
    assert.equal(repair.ok, true);
    assert.deepEqual(calls.slice(2).map(call => call.init.method), ["PATCH", "PATCH"]);
  });

  const pingBody = JSON.parse(calls[0].init.body);
  assert.equal(pingBody.city, "O'Hare");
  assert.equal(calls[0].init.headers.apikey, FULL_ENV.SUPABASE_SECRET_KEY);
});

test("Oracle adapter escapes SQL values and parses paginated responses", async () => {
  const calls = [];
  await withMockedFetch(async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (call.url.endsWith("/database/status")) return new Response(null, { status: 200 });
    const body = String(init.body || "");
    if (body.includes("COUNT(*)")) {
      return Response.json({ items: [{ resultSet: { items: [{ cnt: 12 }] } }] });
    }
    if (body.includes("SELECT id")) {
      return Response.json({ items: [{ resultSet: { items: [{ id: 9 }] } }] });
    }
    return Response.json({items:[{statementId:1,statementType:"dml",result:1}]});
  }, async () => {
    assert.equal(await pingOracle("https://oracle.test", "user", "pass", GEO), true);
    const insert = calls.find(call => String(call.init.body).includes("INSERT"));
    assert.match(insert.init.body, /O''Hare/);
    assert.match(insert.init.headers.Authorization, /^Basic /);

    const query = await queryOracle("https://oracle.test", "user", "pass", 2, 10);
    assert.equal(query.ok, true);
    assert.deepEqual(query.rows, [{ id: 9 }]);
    assert.equal(query.count, 12);
    assert.equal(query.totalPages, 2);
    assert.ok(calls.some(call => String(call.init.body).includes("OFFSET 10 ROWS")));

    const cleanup = await cleanOracle("https://oracle.test", "user", "pass", "delete");
    assert.equal(cleanup.ok, true);
    assert.ok(calls.some(call => String(call.init.body).startsWith("DELETE FROM")));
  });
});

test("service adapters convert upstream failures into stable results", async () => {
  await withMockedFetch(async () => new Response("failed", { status: 500 }), async () => {
    assert.equal(await pingSupabase(FULL_ENV, GEO), false);
    assert.equal((await querySupabase(FULL_ENV)).error, "upstream_error");
    assert.equal(await pingOracle("https://oracle.test", "user", "pass", GEO), false);
    assert.equal((await queryOracle("https://oracle.test", "user", "pass")).error, "upstream_error");
  });
});
