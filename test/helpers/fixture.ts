import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../../src/cli/run.js';
import type { Report } from '../../src/report/model.js';

/** File tree: string/Buffer = file content, null = empty directory. */
export type Tree = Record<string, string | Buffer | null>;

const created: string[] = [];

/**
 * Creates a fixture directory at runtime (so that CRLF, BOMs and symlinks are
 * not altered by Git checkouts) and returns its absolute path.
 */
export async function makeTree(tree: Tree): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'jlgstat-test-'));
  created.push(root);
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, ...rel.split('/'));
    if (content === null) {
      await mkdir(abs, { recursive: true });
    } else {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
  }
  return root;
}

export async function cleanupTrees(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

/** Tries to create a symlink; returns false when the OS does not allow it (Windows without privilege). */
export async function trySymlink(target: string, linkPath: string, type: 'file' | 'dir'): Promise<boolean> {
  try {
    await symlink(target, linkPath, type === 'dir' ? 'junction' : 'file');
    return true;
  } catch {
    return false;
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    cwd,
    env,
    stdoutIsTTY: false,
    stdoutColumns: undefined,
  });
  return { code, stdout, stderr };
}

export async function runJson(args: string[], cwd: string): Promise<{ code: number; report: Report; stderr: string }> {
  const r = await runCli([...args, '--json'], cwd);
  return { code: r.code, report: JSON.parse(r.stdout) as Report, stderr: r.stderr };
}
