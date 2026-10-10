import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["src", "test", "scripts", "job", "service"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs"]);
const MAX_LINES = 400;

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(path));
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (SOURCE_EXTENSIONS.has(extension)) files.push(path);
  }

  return files;
}

const sourceFiles = (await Promise.all(ROOTS.map(collectSourceFiles)))
  .flat()
  .sort();
let failed = false;

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  const lineCount = source === "" ? 0 : source.split(/\r?\n/).length;

  if (lineCount > MAX_LINES) {
    console.error(`${file}: ${lineCount} lines (maximum ${MAX_LINES})`);
    failed = true;
  }

  const syntaxCheck = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });

  if (syntaxCheck.status !== 0) {
    console.error(syntaxCheck.stderr.trim());
    failed = true;
  }
}

if (failed) process.exit(1);

console.log(
  `Checked ${sourceFiles.length} JavaScript files; all are valid and at most ${MAX_LINES} lines.`
);
