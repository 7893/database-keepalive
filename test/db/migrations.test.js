import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const REQUIRED_COLUMNS = [
  "id", "ping_time", "status", "colo", "country", "city", "region", "ip"
];

async function migration(path) {
  return (await readFile(new URL(path, import.meta.url), "utf8")).toLowerCase();
}

test("Supabase migration provides both tables used by service adapters", async () => {
  const sql = await migration("../../migrations/supabase/001_create_keepalive_tables.sql");
  for (const table of ["my_keepalive_logs", "db2_keepalive_logs"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  for (const column of REQUIRED_COLUMNS) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.match(sql, /enable row level security/);
  assert.match(sql, /to service_role/);
});

test("Oracle migration provides the table and columns used by ORDS queries", async () => {
  const sql = await migration("../../migrations/oracle/001_create_keepalive_log.sql");
  assert.match(sql, /create table keepalive_log/);
  for (const column of REQUIRED_COLUMNS) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.match(sql, /keepalive_log_ping_time_idx/);
  assert.match(sql, /sqlcode != -955/);
});
