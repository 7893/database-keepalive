import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'native', 'test', 'scripts', 'migrations', '.github'];
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.py', '.css', '.sql', '.json', '.yaml', '.yml']);
const MAX_LINES = 300;

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '__pycache__') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile() && CODE_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

const files = [...(await Promise.all(ROOTS.map(collect))).flat(), 'Dockerfile', 'package.json', 'package-lock.json'].sort();
let failed = false;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const lines = source === '' ? 0 : source.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (lines > MAX_LINES) {
    console.error(`${file}: ${lines} lines (maximum ${MAX_LINES})`);
    failed = true;
  }
  const extension = extname(file);
  let check;
  if (['.js', '.mjs'].includes(extension))
    check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check && check.status !== 0) {
    console.error(check.stderr?.trim() || check.error?.message || `Could not check ${file}`);
    failed = true;
  }
  if (extension === '.json') {
    try { JSON.parse(source); }
    catch { console.error(`${file}: invalid JSON`); failed = true; }
  }
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} code files: at most ${MAX_LINES} lines; JavaScript and JSON syntax valid.`);
