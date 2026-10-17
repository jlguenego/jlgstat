// Confronts jlgstat's line counts with scc (used as a test oracle, §9.2).
// Usage: bun scripts/compare-scc.mjs <dir> [--tolerance 0.02]
// Requires `bun run build` and `scc` in PATH (https://github.com/boyter/scc).
// Exits 1 when a language differs by more than the tolerance.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
const tolIdx = process.argv.indexOf('--tolerance');
const tolerance = tolIdx > 0 ? Number(process.argv[tolIdx + 1]) : 0.02;
if (!dir) {
  console.error('Usage: bun scripts/compare-scc.mjs <dir> [--tolerance 0.02]');
  process.exit(1);
}
const scc = spawnSync('scc', ['--format', 'json', '--no-gitignore', '--no-ignore', dir], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (scc.error || scc.status !== 0) {
  console.error('scc not found or failed; install it from https://github.com/boyter/scc');
  process.exit(1);
}
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli', 'main.js');
// --all aligns the file set with scc's --no-gitignore --no-ignore.
const ours = JSON.parse(spawnSync(process.execPath, [cli, dir, '--all', '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);

// scc language names → jlgstat language names, where they differ.
const ALIASES = { 'C Header': 'C', 'C++ Header': 'C++', 'Plain Text': 'Text', 'TypeScript Typings': 'TypeScript' };
const sccByLang = new Map();
for (const l of JSON.parse(scc.stdout)) {
  const name = ALIASES[l.Name] ?? l.Name;
  const prev = sccByLang.get(name) ?? { lines: 0, code: 0, comment: 0, blank: 0 };
  sccByLang.set(name, { lines: prev.lines + l.Lines, code: prev.code + l.Code, comment: prev.comment + l.Comment, blank: prev.blank + l.Blank });
}

const rel = (a, b) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / b);
let failures = 0;
console.log('| Language | Lines (jlgstat / scc) | Code | Comment | Blank | Status |');
console.log('|---|---:|---:|---:|---:|---|');
for (const l of ours.byLanguage) {
  const s = sccByLang.get(l.language);
  if (!s) continue;
  const blank = l.physicalLines - l.nonEmptyLines;
  const worst = Math.max(rel(l.physicalLines, s.lines), rel(l.codeLines ?? 0, s.code), rel(l.commentLines ?? 0, s.comment), rel(blank, s.blank));
  const ok = worst <= tolerance;
  if (!ok) failures++;
  console.log(
    `| ${l.language} | ${l.physicalLines} / ${s.lines} | ${l.codeLines} / ${s.code} | ${l.commentLines} / ${s.comment} | ${blank} / ${s.blank} | ${ok ? 'ok' : `diff ${(worst * 100).toFixed(1)}%`} |`,
  );
}
process.exit(failures > 0 ? 1 : 0);
