import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseConfig } from '../src/config.ts';

try {
  const config = parseConfig(await readFile('config.local.json', 'utf8'));
  await chmod('config.local.json', 0o600);
  const secrets = { CONFIG: JSON.stringify(config) };
  if (Buffer.byteLength(secrets.CONFIG, 'utf8') > 5 * 1024) {
    throw new Error('Configuration exceeds Cloudflare\'s 5 KB secret limit. Split large installations across Workers.');
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
  console.error(error instanceof Error && error.name !== 'SyntaxError' ? error.message : 'Invalid config.local.json.');
  process.exitCode = 1;
}
