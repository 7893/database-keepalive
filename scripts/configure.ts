import { readFile, writeFile, chmod } from 'node:fs/promises';
import { SafeError } from '../src/config.ts';
import { parseLocalConfig } from './local-config.ts';

try {
  const config = parseLocalConfig(await readFile('config.local.toml', 'utf8'));
  await chmod('config.local.toml', 0o600);
  const secrets = { CONFIG: JSON.stringify(config) };
  if (Buffer.byteLength(secrets.CONFIG, 'utf8') > 5 * 1024) {
    throw new SafeError('Configuration exceeds Cloudflare\'s 5 KB secret limit. Split large installations across Workers.');
  }
  await writeFile('.secrets.local.json', JSON.stringify(secrets), { mode: 0o600 });
  await chmod('.secrets.local.json', 0o600);
  // Quoted dotenv values retain embedded JSON quotes; line breaks are disallowed.
  const vars = Object.entries(secrets).map(([key, value]) => {
    return `${key}='${value.replace(/'/g, '\\u0027')}'`;
  }).join('\n');
  await writeFile('.dev.vars', vars + '\n', { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
  console.log(`Configured ${config.databases.length} databases. No credentials were printed.`);
} catch (error) {
  const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
  console.error(error instanceof SafeError ? error.message : missing
    ? 'Missing config.local.toml. Copy config.example.toml and fill in your settings; legacy config.local.json is no longer read.'
    : 'Could not configure local secrets. Check file permissions and config.local.toml.');
  process.exitCode = 1;
}
