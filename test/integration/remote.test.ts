import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv } from 'ajv';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MARKER } from '../../src/remote/cache.js';
import { prepareRepo } from '../../src/remote/fetch.js';
import { parseRepoArg } from '../../src/remote/url.js';
import type { Report } from '../../src/report/model.js';
import { cleanupTrees, makeTree, runCli } from '../helpers/fixture.js';
import { type GitFixture, hasGit, makeGitRepo } from '../helpers/gitRepo.js';

afterAll(cleanupTrees);

const schema = JSON.parse(await readFile(new URL('../../schema/jlgstat.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

const listDir = async (dir: string): Promise<string[]> => (await readdir(dir).catch(() => [] as string[])).sort();

describe.skipIf(!hasGit())('repository URL (§3.4)', () => {
  let repo: GitFixture;
  let first: string;
  let head: string;
  let feature: string;

  beforeAll(async () => {
    repo = await makeGitRepo();
    first = await repo.commit(
      {
        'README.md': '# demo\n',
        'src/a.ts': 'const a = 1;\n// comment\n\nexport { a };\n',
        'packages/app/index.ts': 'export const app = 1;\n',
        // Stored with LF; the attributes ask for CRLF in a work tree: jlgstat must see the stored bytes.
        'eol.txt': 'one\ntwo\n',
        '.gitattributes': 'eol.txt text eol=crlf\n',
      },
      'first',
    );
    repo.git('tag', '-a', 'v1.0', '-m', 'v1.0');
    repo.git('checkout', '--quiet', '-b', 'feature/x');
    feature = await repo.commit({ 'src/feature.ts': 'export const f = 2;\n' }, 'feature');
    repo.git('checkout', '--quiet', 'main');
    head = await repo.commit({ 'src/b.ts': 'export const b = 3;\n' }, 'second');
  });

  /** Runs the CLI with an isolated git configuration and a private cache. */
  async function runRemote(args: string[], cache: string, extraEnv: Record<string, string | undefined> = {}) {
    const cwd = await makeTree({});
    const r = await runCli(args, cwd, { ...repo.env, JLGSTAT_CACHE_DIR: cache, ...extraEnv });
    const report = r.code === 0 && args.includes('--json') ? (JSON.parse(r.stdout) as Report) : null;
    return { ...r, report };
  }

  const files = (r: Report): string[] => r.largestFiles.map((f) => f.path).sort();

  test('analyzes the latest commit of the default branch, then removes the clone', async () => {
    const cache = await makeTree({});
    const { code, report, stderr } = await runRemote([repo.url, '--json', '--largest', '50'], cache);
    expect(code).toBe(0);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report!.root).toBe(parseRepoArg(repo.url)!.displayUrl);
    expect(report!.source).toEqual({ url: parseRepoArg(repo.url)!.displayUrl, ref: 'main', commit: head, path: null });
    expect(files(report!)).toEqual(['.gitattributes', 'README.md', 'eol.txt', 'packages/app/index.ts', 'src/a.ts', 'src/b.ts']);
    expect(stderr).toContain('fetching');
    expect(await listDir(path.join(cache, 'tmp'))).toEqual([]);
    expect(await listDir(path.join(cache, 'repos'))).toEqual([]);
  });

  test('files are counted as stored in the repository (no end-of-line conversion)', async () => {
    const cache = await makeTree({});
    const { report } = await runRemote([repo.url, '--json', '--largest', '50'], cache);
    expect(report!.largestFiles.find((f) => f.path === 'eol.txt')!.bytes).toBe(8);
  });

  test('--all never analyzes the repository metadata', async () => {
    const cache = await makeTree({});
    const { code, report } = await runRemote([repo.url, '--json', '--all', '--largest', '50'], cache);
    expect(code).toBe(0);
    expect(report!.directories.some((d) => d.path.split('/').includes('.git'))).toBe(false);
    expect(report!.summary.files).toBe(6);
  });

  test('--ref selects a branch, a tag or a commit', async () => {
    const cache = await makeTree({});
    const branch = await runRemote([repo.url, '--json', '--ref', 'feature/x', '--largest', '50'], cache);
    expect(branch.report!.source!).toMatchObject({ ref: 'feature/x', commit: feature });
    expect(files(branch.report!)).toContain('src/feature.ts');
    expect(files(branch.report!)).not.toContain('src/b.ts');

    const tag = await runRemote([repo.url, '--json', '--ref', 'v1.0'], cache);
    expect(tag.report!.source!).toMatchObject({ ref: 'v1.0', commit: first });

    const sha = await runRemote([repo.url, '--json', '--ref', first], cache);
    expect(sha.report!.source!).toMatchObject({ ref: first, commit: first });
  });

  test('an unknown ref is an error', async () => {
    const cache = await makeTree({});
    const { code, stderr } = await runRemote([repo.url, '--ref', 'nope'], cache);
    expect(code).toBe(1);
    expect(stderr).toContain('ref not found: nope');
    expect(await listDir(path.join(cache, 'tmp'))).toEqual([]);
  });

  test('--keep-clone keeps the clone, reuses and updates it; a run without it removes it', async () => {
    const cache = await makeTree({});
    const one = await runRemote([repo.url, '--json', '--keep-clone'], cache);
    expect(one.code).toBe(0);
    expect(one.stderr).toContain('clone kept in');
    const entries = await listDir(path.join(cache, 'repos'));
    expect(entries).toHaveLength(1);
    const entry = path.join(cache, 'repos', entries[0]!);
    expect(await listDir(entry)).toEqual(['git', MARKER, 'tree'].sort());

    const extra = await repo.commit({ 'src/c.ts': 'export const c = 4;\n' }, 'third');
    try {
      const two = await runRemote([repo.url, '--json', '--keep-clone', '--largest', '50'], cache);
      expect(two.stderr).toContain('updating');
      expect(two.report!.source!.commit).toBe(extra);
      expect(files(two.report!)).toContain('src/c.ts');
      expect(await listDir(path.join(cache, 'repos'))).toEqual(entries);

      const three = await runRemote([repo.url, '--json'], cache);
      expect(three.report!.source!.commit).toBe(extra);
      expect(await listDir(path.join(cache, 'repos'))).toEqual([]);
    } finally {
      repo.git('reset', '--quiet', '--hard', head);
    }
  });

  test('--clear-cache removes the kept clones of one repository, or all of them', async () => {
    const cache = await makeTree({});
    const other = await makeGitRepo();
    await other.commit({ 'x.txt': 'x\n' }, 'x');
    await runRemote([repo.url, '--keep-clone', '--quiet'], cache);
    await runRemote([repo.url, '--keep-clone', '--quiet', '--ref', 'v1.0'], cache);
    await runRemote([other.url, '--keep-clone', '--quiet'], cache);
    await mkdir(path.join(cache, 'repos', 'not-ours'), { recursive: true });
    expect(await listDir(path.join(cache, 'repos'))).toHaveLength(4);

    const targeted = await runRemote(['--clear-cache', repo.url], cache);
    expect(targeted.code).toBe(0);
    expect(targeted.stderr).toMatch(/removed 2 cached entries/);
    expect(await listDir(path.join(cache, 'repos'))).toHaveLength(2);

    const all = await runRemote(['--clear-cache'], cache);
    expect(all.stderr).toMatch(/removed 1 cached entry/);
    expect(await listDir(path.join(cache, 'repos'))).toEqual(['not-ours']);
  });

  test('without git in PATH, a URL is an error and a local directory still works', async () => {
    const cache = await makeTree({});
    const env: Record<string, string | undefined> = {};
    for (const k of Object.keys(repo.env)) if (k.toUpperCase() === 'PATH') env[k] = undefined;
    const noGit = { ...env, PATH: path.join(cache, 'empty-path') };
    const { code, stderr } = await runRemote([repo.url], cache, noGit);
    expect(code).toBe(1);
    expect(stderr).toContain('git is required');
    const local = await runCli(['.'], await makeTree({ 'a.ts': 'x\n' }), noGit);
    expect(local.code).toBe(0);
  });

  test('credentials never appear in messages', async () => {
    const cache = await makeTree({});
    const { code, stderr } = await runRemote(['https://user:s3cret@127.0.0.1:1/o/r.git'], cache);
    expect(code).toBe(1);
    expect(stderr).toContain('cannot access https://127.0.0.1:1/o/r');
    expect(stderr).not.toContain('s3cret');
  });

  test('option checks', async () => {
    const cache = await makeTree({});
    for (const args of [['.', '--ref', 'main'], ['.', '--keep-clone'], ['.', '--clear-cache'], [repo.url, '--clear-cache', '--ref', 'x']]) {
      const { code, stderr } = await runRemote(args, cache);
      expect(code).toBe(1);
      expect(stderr).toContain('error');
    }
  });

  describe('browser URLs (ref and subdirectory)', () => {
    const prepare = async (browserRest: string, ref: string | null = null) => {
      const cache = await makeTree({});
      const warnings: string[] = [];
      const p = await prepareRepo(
        { ...parseRepoArg(repo.url)!, browserRest },
        { ref, keep: false, env: { ...repo.env, JLGSTAT_CACHE_DIR: cache }, cwd: cache, interactive: false, onWarning: (w) => warnings.push(w) },
      );
      return { p, warnings, cache };
    };

    test('only the subdirectory is checked out and analyzed', async () => {
      const { p, cache } = await prepare('main/packages/app');
      try {
        expect(p.source).toMatchObject({ ref: 'main', commit: head, path: 'packages/app' });
        expect(await listDir(p.analyzeDir)).toEqual(['index.ts']);
        expect(existsSync(path.join(p.entry, 'tree', 'README.md'))).toBe(false);
      } finally {
        await p.dispose();
      }
      expect(await listDir(path.join(cache, 'tmp'))).toEqual([]);
    });

    test('a branch name containing / is split against the remote refs', async () => {
      const { p } = await prepare('feature/x/src');
      try {
        expect(p.source).toMatchObject({ ref: 'feature/x', commit: feature, path: 'src' });
        expect(await listDir(p.analyzeDir)).toEqual(['a.ts', 'feature.ts']);
      } finally {
        await p.dispose();
      }
    });

    test('--ref overrides the ref of the URL, with a warning', async () => {
      const { p, warnings } = await prepare('main/src', 'v1.0');
      try {
        expect(p.source).toMatchObject({ ref: 'v1.0', commit: first, path: 'src' });
        expect(warnings).toEqual(['--ref v1.0 overrides "main" found in the URL']);
      } finally {
        await p.dispose();
      }
    });

    test('a missing subdirectory is an error and leaves nothing behind', async () => {
      const cache = await makeTree({});
      await expect(
        prepareRepo(
          { ...parseRepoArg(repo.url)!, browserRest: 'main/nope' },
          { ref: null, keep: false, env: { ...repo.env, JLGSTAT_CACHE_DIR: cache }, cwd: cache, interactive: false },
        ),
      ).rejects.toThrow('directory not found');
      expect(await listDir(path.join(cache, 'tmp'))).toEqual([]);
    });
  });
});
