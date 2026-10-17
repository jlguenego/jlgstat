// Benchmarks the scanner on generated corpora (§9.3). Requires `bun run build`.
// Usage: bun bench/run.mjs [sizes...]   (default: 10000 50000 100000)
// The npx download cost is excluded: the built CLI is run directly, with
// Node.js (the runtime end users get through npx), which must be in PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'dist', 'cli', 'main.js');
if (!existsSync(cli)) {
  console.error('Run "bun run build" first.');
  process.exit(1);
}
const sizes = process.argv.slice(2).map(Number);
const TARGETS = { 10000: 2000, 50000: 5000, 100000: 10000 };
const RUNS = 3;
const node = process.platform === 'win32' ? 'node.exe' : 'node';
const nodeVersion = spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? 'not found';

console.log(`Machine: ${os.cpus()[0]?.model ?? 'unknown'} x${os.cpus().length}, ${(os.totalmem() / 1e9).toFixed(1)} GB RAM, ${os.platform()} ${os.release()}, Node ${nodeVersion}`);
console.log('Warm cache (one untimed run before measuring).\n');
console.log('| Files | Lines | Size | Median time | Max RSS | Target |');
console.log('|---:|---:|---:|---:|---:|---:|');

for (const size of sizes.length > 0 ? sizes : [10000, 50000, 100000]) {
  const corpus = path.join(here, 'corpus', String(size));
  if (!existsSync(corpus)) spawnSync(process.execPath, [path.join(here, 'generate.mjs'), String(size), corpus], { stdio: 'inherit' });

  // Measures wall time and peak memory of the real CLI in a child process.
  const measure = () => {
    const probe = `
      const { spawnSync } = require('node:child_process');
      const t = process.hrtime.bigint();
      const r = spawnSync(process.execPath, [${JSON.stringify(cli)}, ${JSON.stringify(corpus)}, '--json', '--quiet'], { maxBuffer: 1 << 30 });
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const rep = JSON.parse(r.stdout);
      process.stdout.write(JSON.stringify({ ms, files: rep.summary.files, lines: rep.summary.physicalLines, bytes: rep.summary.bytes }));
    `;
    const r = spawnSync(node, ['-e', probe], { maxBuffer: 1 << 30 });
    return JSON.parse(r.stdout.toString());
  };
  // Peak RSS of the CLI itself.
  const rss = () => {
    const probe = `
      process.argv = [process.argv[0], ${JSON.stringify(cli)}, ${JSON.stringify(corpus)}, '--json', '--quiet'];
      process.stdout.write = () => true;
      process.on('exit', () => process.stderr.write(String(process.resourceUsage().maxRSS)));
      import(${JSON.stringify(new URL(`file:///${cli.replace(/\\/g, '/')}`).href)});
    `;
    const r = spawnSync(node, ['-e', probe]);
    return Number(r.stderr.toString().trim().split('\n').pop());
  };

  measure(); // warm-up
  const runs = Array.from({ length: RUNS }, measure).sort((a, b) => a.ms - b.ms);
  const median = runs[Math.floor(RUNS / 2)];
  const maxRssMb = rss() / 1024;
  const target = TARGETS[size];
  console.log(
    `| ${median.files.toLocaleString('en-US')} | ${median.lines.toLocaleString('en-US')} | ${(median.bytes / 1e6).toFixed(1)} MB | ${(median.ms / 1000).toFixed(2)} s | ${maxRssMb.toFixed(0)} MB | ${target ? `< ${target / 1000} s ${median.ms < target ? '✓' : '✗'}` : '-'} |`,
  );
}
