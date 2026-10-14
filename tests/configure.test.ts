import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseLocalConfig } from '../scripts/local-config.ts';
import { parseConfig, SafeError } from '../src/config.ts';

const example = await readFile(new URL('../config.example.toml', import.meta.url), 'utf8');
const configure = fileURLToPath(new URL('../scripts/configure.ts', import.meta.url));

test('commented TOML template preserves defaults, node order, overrides and JSON transport', () => {
  const config = parseLocalConfig(example);
  assert.equal(config.timezone, 'Asia/Hong_Kong');
  assert.deepEqual(config.dailyCheckins, { min: 1, max: 3 });
  assert.deepEqual(config.retention, { maxRows: 64 });
  assert.deepEqual(config.databases.map(node => node.id), ['supabase', 'adb_jp', 'mysql_jp']);
  assert.equal(config.databases[1]?.dailyCheckins, 2);
  assert.deepEqual(parseConfig(JSON.stringify(config)), config);
});

test('TOML rejects both retention rules in either order, globally and per node', () => {
  for (const value of ['{ maxRows = 64, maxAgeDays = 30 }', '{ maxAgeDays = 30, maxRows = 64 }']) {
    assert.throws(() => parseLocalConfig(example.replace('retention = { maxRows = 64 }', `retention = ${value}`)), /exactly one rule/);
    assert.throws(() => parseLocalConfig(`${example}\nretention = ${value}\n`), /exactly one rule/);
  }
  const config = parseLocalConfig(example.replace('retention = { maxRows = 64 }', 'retention = false') + '\nretention = { maxAgeDays = 30 }\n');
  assert.equal(config.retention, false);
  assert.deepEqual(config.databases[2]?.retention, { maxAgeDays: 30 });
});

test('TOML validates field types and reports syntax locations without source secrets', () => {
  assert.throws(() => parseLocalConfig(example.replace('"replace-with-server-side-secret-key"', '2026-10-14')), /field key is required/);
  for (const source of ['password = "SECRET_CANARY"\npassword = "SECRET_CANARY"', 'password = "SECRET_CANARY']) {
    assert.throws(() => parseLocalConfig(source), error => {
      assert.ok(error instanceof SafeError);
      assert.match(error.message, /line \d+, column \d+/);
      assert.ok(!error.message.includes('SECRET_CANARY'));
      return true;
    });
  }
});

test('configure writes private JSON secrets, preserves TOML comments and rejects bad input before writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keepalive-config-'));
  const run = () => {
    const result = spawnSync(process.execPath, [configure], { cwd: dir, encoding: 'utf8' });
    assert.ifError(result.error);
    return result;
  };
  try {
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Copy config.example.toml/);

    const secret = "quote'back\\slash#中文";
    const source = example.replace('"replace-with-server-side-secret-key"', JSON.stringify(secret));
    await writeFile(join(dir, 'config.local.toml'), source, { mode: 0o644 });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(secret));
    const saved = await readFile(join(dir, '.secrets.local.json'), 'utf8');
    const { CONFIG } = JSON.parse(saved);
    assert.deepEqual(parseConfig(CONFIG), parseLocalConfig(source));
    const vars = await readFile(join(dir, '.dev.vars'), 'utf8');
    assert.ok(vars.startsWith("CONFIG='") && vars.endsWith("'\n"));
    const dotenvValue = vars.slice("CONFIG='".length, -2);
    assert.ok(!dotenvValue.includes("'"));
    assert.deepEqual(JSON.parse(dotenvValue), JSON.parse(CONFIG));
    assert.equal(await readFile(join(dir, 'config.local.toml'), 'utf8'), source);
    for (const file of ['config.local.toml', '.secrets.local.json', '.dev.vars']) {
      assert.equal((await stat(join(dir, file))).mode & 0o777, 0o600);
    }

    for (const invalid of ['password = "SECRET_CANARY', source.replace(JSON.stringify(secret), JSON.stringify('中'.repeat(2000)))]) {
      await writeFile(join(dir, 'config.local.toml'), invalid);
      const failure = run();
      assert.equal(failure.status, 1);
      assert.ok(!failure.stderr.includes('SECRET_CANARY'));
      assert.equal(await readFile(join(dir, '.secrets.local.json'), 'utf8'), saved);
      assert.equal(await readFile(join(dir, '.dev.vars'), 'utf8'), vars);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
