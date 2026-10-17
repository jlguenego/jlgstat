// Tests the real npm package (§11.2): `bun pm pack`, install the tarball in a
// temporary project, then run the installed `jlgstat` binary with Node.js,
// the runtime end users get through `npx`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'jlgstat-pack-'));
const bun = process.execPath;
const node = process.platform === 'win32' ? 'node.exe' : 'node';

function check(cond, message) {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok - ${message}`);
  }
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs, base) : [path.relative(base, abs).split(path.sep).join('/')];
  });
}

try {
  execFileSync(bun, ['pm', 'pack', '--destination', work, '--quiet'], { cwd: root, stdio: 'inherit' });
  const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
  check(tarball !== undefined, `tarball created (${tarball})`);

  const project = path.join(work, 'project');
  mkdirSync(project);
  writeFileSync(path.join(project, 'package.json'), '{"name":"pack-test","private":true}');
  execFileSync(bun, ['add', path.join(work, tarball)], { cwd: project, stdio: 'inherit' });

  const installed = path.join(project, 'node_modules', 'jlgstat');
  const published = listFiles(installed);
  check(published.includes('dist/cli/main.js'), 'package contains dist/cli/main.js');
  check(published.includes('dist/read/worker.js'), 'package contains the worker');
  check(published.includes('schema/jlgstat.schema.json'), 'package contains the JSON Schema');
  check(!published.some((p) => p.startsWith('src/') || p.startsWith('test/')), 'package contains no sources or tests');

  const { bin } = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  const cli = path.join(installed, bin.jlgstat);
  check(existsSync(cli), `bin entry exists (${bin.jlgstat})`);
  const jlgstat = (args) => spawnSync(node, [cli, ...args], { cwd: project, encoding: 'utf8' });

  const sample = path.join(work, 'sample');
  mkdirSync(path.join(sample, 'src'), { recursive: true });
  writeFileSync(path.join(sample, 'src', 'a.ts'), '// c\nconst a = 1;\n');
  writeFileSync(path.join(sample, 'README.md'), '# Sample\n');

  const version = jlgstat(['--version']);
  check(version.status === 0 && /^\d+\.\d+\.\d+/.test(version.stdout), `--version works under Node.js (${version.stdout?.trim()})`);

  const json = jlgstat([sample, '--json']);
  let report = null;
  try {
    report = JSON.parse(json.stdout);
  } catch {}
  check(json.status === 0 && report !== null, '--json exits 0 with valid JSON');
  check(report?.summary.files === 2 && report?.summary.physicalLines === 3, 'counts are correct');

  const text = jlgstat([sample]);
  check(text.status === 0 && text.stdout.includes('By extension'), 'terminal report works');

  const missing = jlgstat([path.join(work, 'nope')]);
  check(missing.status === 1, 'missing path exits 1');
} finally {
  rmSync(work, { recursive: true, force: true });
}
