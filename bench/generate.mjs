// Generates a deterministic synthetic corpus for benchmarks.
// Usage: bun bench/generate.mjs <files> [outDir]
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const count = Number(process.argv[2] ?? 10000);
const out = path.resolve(process.argv[3] ?? `bench/corpus/${count}`);

// Small deterministic PRNG (mulberry32).
let seed = 42;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const KINDS = [
  { ext: '.ts', weight: 40, line: (i) => (i % 9 === 0 ? `// comment ${i}` : `export const value${i} = compute(${i}, "str // ${i}");`) },
  { ext: '.js', weight: 15, line: (i) => (i % 7 === 0 ? `/* block ${i} */` : `function f${i}() { return ${i}; }`) },
  { ext: '.py', weight: 10, line: (i) => (i % 8 === 0 ? `# comment ${i}` : `def f${i}(x):  return x + ${i}`) },
  { ext: '.json', weight: 8, line: (i) => `  "key${i}": ${i},` },
  { ext: '.md', weight: 8, line: (i) => (i % 5 === 0 ? '' : `Some documentation text, line ${i}.`) },
  { ext: '.css', weight: 6, line: (i) => `.c${i} { margin: ${i}px; }` },
  { ext: '.yml', weight: 5, line: (i) => `key${i}: value${i}` },
  { ext: '.go', weight: 5, line: (i) => `func F${i}() int { return ${i} }` },
  { ext: '.png', weight: 3, binary: true },
];
const totalWeight = KINDS.reduce((s, k) => s + k.weight, 0);
const pick = () => {
  let r = rand() * totalWeight;
  for (const k of KINDS) if ((r -= k.weight) < 0) return k;
  return KINDS[0];
};

await rm(out, { recursive: true, force: true });
const dirs = [];
for (let a = 0; a < 20; a++) for (let b = 0; b < 10; b++) dirs.push(`pkg${a}/mod${b}`);
await Promise.all(dirs.map((d) => mkdir(path.join(out, d), { recursive: true })));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)]);
let bytes = 0;
const batch = [];
for (let i = 0; i < count; i++) {
  const kind = pick();
  const file = path.join(out, dirs[i % dirs.length], `file${i}${kind.ext}`);
  let content;
  if (kind.binary) content = PNG;
  else {
    // Long-tailed line counts: most files are small, a few are large.
    const lines = Math.max(1, Math.floor(10 + Math.pow(rand(), 4) * 950)); // mean ~200, long tail
    const parts = new Array(lines);
    for (let l = 0; l < lines; l++) parts[l] = kind.line(l);
    content = parts.join('\n') + '\n';
  }
  bytes += content.length;
  batch.push(writeFile(file, content));
  if (batch.length >= 256) await Promise.all(batch.splice(0));
}
await Promise.all(batch);
console.log(`Generated ${count} files (${(bytes / 1e6).toFixed(1)} MB) in ${out}`);
