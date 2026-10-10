import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { PUBLIC_CACHE_CONTROL, publicCacheKey } from "../src/public-protection.js";
import { request, withMockedFetch } from "./helpers.js";

async function withMockedCache(cache, action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache }
  });
  try {
    return await action();
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  }
}

test("public cache keys normalize aliases and isolate privacy modes", () => {
  const first = publicCacheKey(request("/?page=3&ignored=one"));
  const second = publicCacheKey(request("/?sb_p=3&us_p=3&jp_p=3&db2_p=3&mysql_jp_p=3&mysql_us_p=3&ignored=two"));
  const full = publicCacheKey(request("/?page=3"), true);

  assert.equal(first.url, second.url);
  assert.notEqual(first.url, full.url);
  assert.equal(new URL(first.url).searchParams.get("supabase_p"), "3");
  assert.equal(new URL(first.url).searchParams.has("ignored"), false);
});

test("successful public GET responses are cached at the edge", async () => {
  const stored = new Map();
  const pending = [];
  const cache = {
    async match(key) {
      return stored.get(key.url)?.clone();
    },
    async put(key, response) {
      stored.set(key.url, response.clone());
    }
  };
  const env = {
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SECRET_KEY: "test-key"
  };
  let fetchCalls = 0;

  await withMockedCache(cache, () => withMockedFetch(async () => {
    fetchCalls += 1;
    return new Response("[]", {
      headers: { "content-type": "application/json", "content-range": "*/0" }
    });
  }, async () => {
    const ctx = { waitUntil(promise) { pending.push(promise); } };
    const first = await worker.fetch(request("/api/data?service=supabase&page=1&ignored=one"), env, ctx);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), PUBLIC_CACHE_CONTROL);
    await first.json();
    await Promise.all(pending);

    const second = await worker.fetch(request("/api/data?ignored=two&page=1&service=supabase"), env, ctx);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("cache-control"), PUBLIC_CACHE_CONTROL);
    await second.json();
  }));

  assert.equal(fetchCalls, 1);
  assert.equal(stored.size, 1);
});

test("public limiter rejects excess traffic before upstream access", async () => {
  let fetchCalls = 0;
  let limiterKey;
  const env = {
    PUBLIC_RATE_LIMITER: {
      async limit({ key }) {
        limiterKey = key;
        return { success: false };
      }
    }
  };

  await withMockedFetch(async () => {
    fetchCalls += 1;
    throw new Error("unexpected fetch");
  }, async () => {
    const response = await worker.fetch(request("/api/data?service=supabase", {
      headers: { "cf-connecting-ip": "203.0.113.42" }
    }), env, {});
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.error, "rate_limited");
  });

  assert.match(limiterKey, /^[a-f0-9]{64}$/);
  assert.equal(fetchCalls, 0);
});

test("public errors remain uncached", async () => {
  let puts = 0;
  const cache = {
    async match() { return undefined; },
    async put() { puts += 1; }
  };

  await withMockedCache(cache, async () => {
    const response = await worker.fetch(request("/api/data?service=supabase"), {}, {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  assert.equal(puts, 0);
});


test("missing or failed public protection never reaches upstream", async () => {
  await withMockedFetch(async () => { throw new Error("unexpected upstream access"); }, async () => {
    for (const env of [{}, { PUBLIC_RATE_LIMITER: { limit: async () => { throw new Error("offline"); } } }]) {
      const response = await worker.fetch(request("/api/data?service=supabase"), env, {});
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "protection_unavailable");
    }
  });
});
