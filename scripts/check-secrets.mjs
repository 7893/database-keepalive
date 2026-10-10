import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const SKIPPED_DIRECTORIES = new Set([".git", ".wrangler", "coverage", "node_modules"]);
const SKIPPED_FILES = new Set(["check-secrets.mjs"]);
const TEXT_EXTENSIONS = new Set([
  ".bak", ".css", ".env", ".example", ".html", ".js", ".json", ".jsonc", ".md",
  ".mjs", ".py", ".service", ".sql", ".toml", ".txt", ".yaml", ".yml"
]);
const TEXT_FILENAMES = new Set([".gitignore", "LICENSE"]);
const PLACEHOLDER = /(?:example|fake|placeholder|replace|sample|test|your[-_])/i;

const SECRET_PATTERNS = [
  ["private key", /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["OpenAI-style token", /sk-[A-Za-z0-9_-]{20,}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["credential-bearing URL", /(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?):\/\/[^/\s:@]+:[^/\s@]+@/g]
];

const ASSIGNMENT_PATTERN = /\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASS))\b\s*[:=]\s*["'`]?([^"'`,\s}]+)/g;

function isTextFile(file) {
  return TEXT_FILENAMES.has(basename(file)) || TEXT_EXTENSIONS.has(extname(file).toLowerCase());
}

async function collectFiles(target) {
  const metadata = await stat(target);
  if (metadata.isFile()) {
    return isTextFile(target) && !SKIPPED_FILES.has(basename(target)) ? [target] : [];
  }
  if (!metadata.isDirectory() || SKIPPED_DIRECTORIES.has(basename(target))) return [];

  const files = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(target, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (isTextFile(path) && !SKIPPED_FILES.has(entry.name)) files.push(path);
  }
  return files;
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

const requestedRoots = process.argv.slice(2);
const roots = requestedRoots.length ? requestedRoots : ["."];
const files = (await Promise.all(roots.map(root => collectFiles(resolve(root))))).flat().sort();
const findings = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [label, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      findings.push({ file, label, line: lineNumber(source, match.index) });
    }
  }

  ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(ASSIGNMENT_PATTERN)) {
    if (!PLACEHOLDER.test(match[2])) {
      findings.push({ file, label: `possible value assigned to ${match[1]}`, line: lineNumber(source, match.index) });
    }
  }
}

if (findings.length) {
  for (const finding of findings) {
    const displayPath = relative(process.cwd(), finding.file) || basename(finding.file);
    console.error(`${displayPath}:${finding.line}: ${finding.label}`);
  }
  console.error(`Found ${findings.length} possible secret(s); review before committing.`);
  process.exit(1);
}

console.log(`Scanned ${files.length} text files; no likely committed secrets found.`);
