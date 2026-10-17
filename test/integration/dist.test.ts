import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'bun:test';
import { cleanupTrees, makeTree } from '../helpers/fixture.js';

afterAll(cleanupTrees);

const cli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));

function runDist(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const normalize = (json: string) => {
  const report = JSON.parse(json);
  report.scan.durationMs = 0;
  return report;
};

// Requires `bun run build`; the compiled CLI is the only one that uses worker threads.
test.skipIf(!existsSync(cli))('worker threads give the same report as in-process analysis', async () => {
  const tree: Record<string, string | Buffer> = {};
  for (let i = 0; i < 800; i++) {
    const dir = `d${i % 13}/s${i % 7}`;
    if (i % 50 === 0) tree[`${dir}/img${i}.png`] = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    else if (i % 3 === 0) tree[`${dir}/f${i}.py`] = `# c\n"""doc"""\nx = ${i}\n\n`.repeat(i % 17);
    else tree[`${dir}/f${i}.ts`] = `// c\nconst a${i} = "${i}";\r\n/* b\n*/\n`.repeat(i % 11);
  }
  const root = await makeTree(tree);
  const inProcess = runDist([root, '--json'], { JLGSTAT_WORKERS: '0' });
  const pooled = runDist([root, '--json'], { JLGSTAT_WORKERS: '3' });
  expect(inProcess.code).toBe(0);
  expect(pooled.code).toBe(0);
  expect(normalize(pooled.stdout)).toEqual(normalize(inProcess.stdout));
  expect(normalize(pooled.stdout).summary.files).toBe(800);
});

test.skipIf(!existsSync(cli))('compiled binary: exit codes and streams', async () => {
  const root = await makeTree({ 'a.ts': 'x\n' });
  const ok = runDist([root, '--json']);
  expect(ok.code).toBe(0);
  expect(ok.stderr).toBe('');
  expect(() => JSON.parse(ok.stdout)).not.toThrow();
  const bad = runDist([root, '--depth', 'x']);
  expect(bad.code).toBe(1);
  expect(bad.stdout).toBe('');
});
