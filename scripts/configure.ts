import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseDatabases } from '../src/config.ts';

try {
  const config = JSON.parse(await readFile('config.local.json', 'utf8'));
  const databases = parseDatabases(JSON.stringify(config.databases));
  await chmod('config.local.json', 0o600);
  const secrets = { DATABASES: JSON.stringify(databases) };
  await writeFile('.secrets.local.json', JSON.stringify(secrets), { mode: 0o600 });
  await chmod('.secrets.local.json', 0o600);
  // Quoted dotenv values retain embedded JSON quotes; line breaks are disallowed.
  const vars = Object.entries(secrets).map(([key, value]) => {
    return `${key}='${key === 'DATABASES' ? value.replace(/'/g, '\\u0027') : value}'`;
  }).join('\n');
  await writeFile('.dev.vars', vars + '\n', { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
  console.log(`Configured ${databases.length} databases. No credentials were printed.`);
} catch (error) {
  console.error(error instanceof Error && error.name !== 'SyntaxError' ? error.message : 'Invalid config.local.json.');
  process.exitCode = 1;
}
