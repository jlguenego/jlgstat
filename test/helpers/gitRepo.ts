import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTree, type Tree } from './fixture.js';

export function hasGit(): boolean {
  return spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
}

/** Environment isolated from the user's and system git configuration (signing, templates, autocrlf…). */
export async function isolatedGitEnv(extra: Record<string, string> = {}): Promise<Record<string, string | undefined>> {
  const home = await makeTree({ 'gitconfig.empty': '' });
  // Drop every GIT_* variable of the developer (GIT_CONFIG_COUNT, GIT_TEMPLATE_DIR, GIT_DIR…).
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_')));
  return {
    ...base,
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig.empty'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'jlgstat test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'jlgstat test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

export interface GitFixture {
  /** Repository directory (served through `url`). */
  dir: string;
  /** file:// URL of the repository. */
  url: string;
  env: Record<string, string | undefined>;
  git: (...args: string[]) => string;
  /** Writes files, then commits them; returns the commit SHA. */
  commit: (tree: Tree, message: string) => Promise<string>;
}

/** Creates an empty repository (default branch `main`) that serves partial and by-SHA fetches. */
export async function makeGitRepo(): Promise<GitFixture> {
  const dir = await makeTree({});
  const env = await isolatedGitEnv();
  const git = (...args: string[]): string => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '--quiet', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'uploadpack.allowFilter', 'true');
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  const commit = async (tree: Tree, message: string): Promise<string> => {
    for (const [rel, content] of Object.entries(tree)) {
      const abs = path.join(dir, ...rel.split('/'));
      if (content === null) {
        await mkdir(abs, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, url: pathToFileURL(dir).href, env, git, commit };
}
