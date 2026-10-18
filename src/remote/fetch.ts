import { rmSync } from 'node:fs';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RepositorySource } from '../report/model.js';
import { cacheRoot, ensureDir, entryDir, readMarker, removeDir, tmpDir, writeMarker } from './cache.js';
import { type Env, gitEnv, GitNotFoundError, runGit } from './git.js';
import { RemoteError, type RepoSpec } from './url.js';

// Fetching a repository (§3.4). Layout of an entry (kept clone or temporary one):
//   <entry>/git/   repository (core.worktree points to tree/)
//   <entry>/tree/  checked-out files, without any .git: never analyzed, even with --all
//   <entry>/jlgstat-entry.json

export interface PrepareOptions {
  ref: string | null;
  keep: boolean;
  env: Env;
  cwd: string;
  /** True when git may prompt the user (stdin is a terminal). */
  interactive: boolean;
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
}

export interface PreparedRepo {
  /** Directory to analyze: the checked-out tree or its requested subdirectory. */
  analyzeDir: string;
  /** Entry directory (shown when the clone is kept). */
  entry: string;
  source: RepositorySource;
  /** Removes the clone unless it is kept; idempotent. */
  dispose(): Promise<void>;
}

interface RemoteRefs {
  defaultBranch: string | null;
  refs: Set<string>;
}

class MissingDirectoryError extends RemoteError {}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHORT_SHA = /^[0-9a-f]{7,39}$/i;

export function parseLsRemote(output: string): RemoteRefs {
  let defaultBranch: string | null = null;
  const refs = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const sym = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
    if (sym) {
      defaultBranch = sym[1]!;
      continue;
    }
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const name = line.slice(tab + 1);
    if (!name.endsWith('^{}')) refs.add(name);
  }
  return { defaultBranch, refs };
}

const hasRef = (r: RemoteRefs, name: string): boolean => r.refs.has(`refs/heads/${name}`) || r.refs.has(`refs/tags/${name}`);

/** Splits `<ref>/<dir>` from a browser URL using the longest branch or tag of the remote. */
export function splitBrowserRest(rest: string, remote: RemoteRefs): { ref: string; path: string | null } {
  const segments = rest.split('/').filter((s) => s !== '');
  for (let i = segments.length; i >= 1; i--) {
    const candidate = segments.slice(0, i).join('/');
    if (hasRef(remote, candidate) || (i === 1 && FULL_SHA.test(candidate))) {
      return { ref: candidate, path: i < segments.length ? segments.slice(i).join('/') : null };
    }
  }
  throw new RemoteError(`no branch or tag of the repository matches "${rest}"`);
}

/** Resolves the requested ref to the name shown in the report and the refspec to fetch. */
export function resolveRef(requested: string | null, remote: RemoteRefs): { name: string; target: string } {
  if (requested === null) {
    if (remote.defaultBranch !== null) return { name: remote.defaultBranch, target: `refs/heads/${remote.defaultBranch}` };
    if (remote.refs.has('HEAD')) return { name: 'HEAD', target: 'HEAD' };
    throw new RemoteError('the repository is empty');
  }
  if (requested.startsWith('refs/') && remote.refs.has(requested)) {
    return { name: requested.replace(/^refs\/(heads|tags)\//, ''), target: requested };
  }
  if (remote.refs.has(`refs/heads/${requested}`)) return { name: requested, target: `refs/heads/${requested}` };
  if (remote.refs.has(`refs/tags/${requested}`)) return { name: requested, target: `refs/tags/${requested}` };
  if (FULL_SHA.test(requested)) return { name: requested.toLowerCase(), target: requested.toLowerCase() };
  if (SHORT_SHA.test(requested)) throw new RemoteError(`ref not found: ${requested} (give the full commit SHA)`);
  throw new RemoteError(`ref not found: ${requested}`);
}

function normalizeSubPath(p: string | null): string | null {
  if (p === null) return null;
  const segments = p.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) throw new RemoteError(`invalid directory in the URL: ${p}`);
  return segments.length === 0 ? null : segments.join('/');
}

/** Non-cone sparse-checkout pattern selecting one directory (gitignore syntax, special characters escaped). */
const sparsePattern = (dir: string): string => `/${dir.replace(/[\\*?[\]!#]/g, (c) => `\\${c}`)}/\n`;

const PARTIAL_CONFIG: readonly [string, string][] = [
  ['core.repositoryformatversion', '1'],
  ['extensions.partialClone', 'origin'],
  ['remote.origin.promisor', 'true'],
  ['remote.origin.partialclonefilter', 'blob:none'],
];

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Fetches the requested commit of a repository and checks it out, reusing a kept clone when there is one. */
export async function prepareRepo(spec: RepoSpec, o: PrepareOptions): Promise<PreparedRepo> {
  const root = cacheRoot(o.env, o.cwd);
  await ensureDir(root);
  const env = gitEnv(o.env, o.interactive);
  // Never run hooks (§10), never let a remote use the `ext::` transport, and keep long paths working on Windows.
  const base = [
    '-c',
    `core.hooksPath=${path.join(root, 'no-hooks')}`,
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.longpaths=true',
  ];
  const git = (args: string[], cwd: string = root): Promise<string> => runGit([...base, ...args], env, cwd);

  let remote: RemoteRefs;
  try {
    remote = parseLsRemote(await git(['ls-remote', '--symref', '--', spec.cloneUrl]));
  } catch (err) {
    if (err instanceof GitNotFoundError) throw err;
    throw new RemoteError(`cannot access ${spec.displayUrl}: ${(err as Error).message}`);
  }

  const fromUrl = spec.browserRest === null ? null : splitBrowserRest(spec.browserRest, remote);
  if (o.ref !== null && fromUrl !== null && o.ref !== fromUrl.ref) {
    o.onWarning?.(`--ref ${o.ref} overrides "${fromUrl.ref}" found in the URL`);
  }
  const requested = o.ref ?? fromUrl?.ref ?? null;
  const resolved = resolveRef(requested, remote);
  const subPath = normalizeSubPath(fromUrl?.path ?? null);

  const cached = entryDir(root, spec.key, requested, subPath);
  const reuse = (await readMarker(cached)) !== null && (await isDirectory(path.join(cached, 'git')));
  let entry: string;
  if (reuse || o.keep) {
    entry = cached;
    if (!reuse) await removeDir(cached);
  } else {
    await ensureDir(tmpDir(root));
    entry = await mkdtemp(path.join(tmpDir(root), 'clone-'));
  }
  const gitDir = path.join(entry, 'git');
  const tree = path.join(entry, 'tree');

  // Removed on failure or interruption, unless it is a kept clone from an earlier run.
  let removeOnAbort = !(reuse && o.keep);
  const onSignal = (signal: NodeJS.Signals): void => {
    if (removeOnAbort) {
      try {
        rmSync(entry, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        // Best effort: --clear-cache removes leftovers.
      }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let disposed = false;
  const release = async (remove: boolean): Promise<void> => {
    if (disposed) return;
    disposed = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (remove) await removeDir(entry);
  };

  try {
    o.onStatus?.(`${reuse ? 'updating' : 'fetching'} ${spec.displayUrl} @ ${resolved.name}${subPath ? ` (${subPath}/)` : ''}`);
    const g = (args: string[]): Promise<string> => git([`--git-dir=${gitDir}`, ...args], tree);
    await ensureDir(tree);
    if (reuse) {
      await g(['remote', 'set-url', 'origin', spec.cloneUrl]);
    } else {
      await git(['init', '--bare', '--quiet', '--template=', gitDir]);
      await g(['config', 'core.bare', 'false']);
      await g(['config', 'core.worktree', tree]);
      await g(['remote', 'add', 'origin', spec.cloneUrl]);
    }
    await ensureDir(path.join(gitDir, 'info'));
    // Files are checked out exactly as stored: no end-of-line conversion, no filters (LFS stays as pointers).
    await writeFile(path.join(gitDir, 'info', 'attributes'), '* -text -filter -ident !working-tree-encoding\n');

    let partial = false;
    if (subPath !== null) {
      await g(['config', 'core.sparseCheckout', 'true']);
      await g(['config', 'core.sparseCheckoutCone', 'false']);
      await writeFile(path.join(gitDir, 'info', 'sparse-checkout'), sparsePattern(subPath));
      for (const [k, v] of PARTIAL_CONFIG) await g(['config', k, v]);
      partial = true;
    }

    const fetchArgs = ['fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', resolved.target];
    try {
      await g(partial ? [...fetchArgs.slice(0, -2), '--filter=blob:none', ...fetchArgs.slice(-2)] : fetchArgs);
    } catch (err) {
      if (!partial) throw err;
      // Server without partial clone support: fetch the whole commit.
      for (const [k] of PARTIAL_CONFIG.slice(1)) await g(['config', '--unset', k]).catch(() => '');
      await g(fetchArgs);
    }
    const commit = (await g(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'])).trim();
    await g(['checkout', '--quiet', '--force', '--detach', commit]);
    if (reuse) await g(['clean', '-ffdxq']);

    const analyzeDir = subPath === null ? tree : path.join(tree, ...subPath.split('/'));
    if (!(await isDirectory(analyzeDir))) {
      throw new MissingDirectoryError(`directory not found in the repository at ${resolved.name}: ${subPath}`);
    }
    await writeMarker(entry, {
      url: spec.displayUrl,
      key: spec.key,
      ref: requested,
      path: subPath,
      commit,
      lastUsed: new Date().toISOString(),
    });
    removeOnAbort = !o.keep;
    return {
      analyzeDir,
      entry,
      source: { url: spec.displayUrl, ref: resolved.name, commit, path: subPath },
      dispose: () => release(!o.keep),
    };
  } catch (err) {
    await release(removeOnAbort);
    if (err instanceof MissingDirectoryError) throw err;
    if (err instanceof RemoteError) throw new RemoteError(`cannot fetch ${spec.displayUrl} @ ${resolved.name}: ${err.message}`);
    throw err;
  }
}
