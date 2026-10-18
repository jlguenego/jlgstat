import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { compareReports, loadSnapshot, SnapshotError } from '../compare/compare.js';
import { atomicWrite } from '../io/atomicWrite.js';
import { cacheRoot, clearCache } from '../remote/cache.js';
import { type PreparedRepo, prepareRepo } from '../remote/fetch.js';
import { parseRepoArg, RemoteError, type RepoSpec } from '../remote/url.js';
import { buildReport } from '../report/build.js';
import { formatBytes, formatInt } from '../report/format.js';
import type { Report } from '../report/model.js';
import { createProgress } from '../report/progress.js';
import { renderTerminal } from '../report/terminal.js';
import { walk } from '../scan/walker.js';
import { HELP, parseCliArgs, UsageError, type CliOptions } from './args.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_PARTIAL = 2;

export interface RunIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  stdoutIsTTY: boolean;
  stdoutColumns: number | undefined;
  /** True when stdin is a terminal: git may then ask for credentials. */
  stdinIsTTY?: boolean;
  progressStream?: NodeJS.WriteStream;
}

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Root as shown in the report: relative to the working directory, `/`
 * separators, never an absolute path (§10).
 */
function displayRoot(cwd: string, abs: string): string {
  const rel = path.relative(cwd, abs);
  if (rel === '') return '.';
  if (path.isAbsolute(rel)) return path.basename(abs) || '.';
  return rel.split(path.sep).join('/');
}

/** Root of a remote analysis: the URL, followed by the analyzed subdirectory. */
function remoteRoot(p: PreparedRepo): string {
  return p.source.path === null ? p.source.url : `${p.source.url}/${p.source.path}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function isDirectory(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function checkDirectory(abs: string, given: string): Promise<void> {
  let s;
  try {
    s = await stat(abs);
  } catch {
    throw new UsageError(`path not found: ${given}`);
  }
  if (!s.isDirectory()) {
    throw new UsageError(`not a directory: ${given} (jlgstat analyzes a directory; use --include to target files)`);
  }
}

export async function run(argv: readonly string[], io: RunIO): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    io.stderr(`jlgstat: error: ${errorMessage(err)}\nRun "jlgstat --help" for usage.\n`);
    return EXIT_ERROR;
  }
  if (opts.help) {
    io.stdout(HELP);
    return EXIT_OK;
  }
  const version = toolVersion();
  if (opts.version) {
    io.stdout(`${version}\n`);
    return EXIT_OK;
  }

  // A local directory wins over an argument that merely looks like a URL.
  let rootAbs = path.resolve(io.cwd, opts.path);
  let repo: RepoSpec | null = null;
  try {
    repo = parseRepoArg(opts.path);
  } catch (err) {
    if (!(err instanceof RemoteError)) throw err;
    io.stderr(`jlgstat: error: ${err.message}\n`);
    return EXIT_ERROR;
  }
  if (repo !== null && (await isDirectory(rootAbs))) {
    if (opts.ref !== null || opts.keepClone) {
      io.stderr(`jlgstat: error: ${opts.path} is a local directory; --ref and --keep-clone apply to repository URLs\n`);
      return EXIT_ERROR;
    }
    repo = null;
  }

  if (opts.clearCache) {
    const root = cacheRoot(io.env, io.cwd);
    try {
      const r = await clearCache(root, repo?.key ?? null);
      io.stderr(`jlgstat: removed ${formatInt(r.entries)} cached ${r.entries === 1 ? 'entry' : 'entries'} (${formatBytes(r.bytes)})${repo ? ` for ${repo.displayUrl}` : ''}\n`);
    } catch (err) {
      io.stderr(`jlgstat: error: cannot clear the cache ${root}: ${errorMessage(err)}\n`);
      return EXIT_ERROR;
    }
    return EXIT_OK;
  }

  let baseline: Report | null = null;
  try {
    if (repo === null) await checkDirectory(rootAbs, opts.path);
    if (opts.compare !== null) baseline = await loadSnapshot(path.resolve(io.cwd, opts.compare));
  } catch (err) {
    if (err instanceof UsageError || err instanceof SnapshotError) {
      io.stderr(`jlgstat: error: ${err.message}\n`);
      return EXIT_ERROR;
    }
    throw err;
  }

  let prepared: PreparedRepo | null = null;
  if (repo !== null) {
    try {
      prepared = await prepareRepo(repo, {
        ref: opts.ref,
        keep: opts.keepClone,
        env: io.env,
        cwd: io.cwd,
        interactive: io.stdinIsTTY === true,
        onStatus: (m) => {
          if (!opts.quiet) io.stderr(`jlgstat: ${m}\n`);
        },
        onWarning: (m) => io.stderr(`jlgstat: warning: ${m}\n`),
      });
    } catch (err) {
      if (!(err instanceof RemoteError)) throw err;
      io.stderr(`jlgstat: error: ${err.message}\n`);
      return EXIT_ERROR;
    }
    rootAbs = prepared.analyzeDir;
    if (opts.keepClone && !opts.quiet) io.stderr(`jlgstat: clone kept in ${prepared.entry}\n`);
  }
  try {
    return await analyze(opts, io, version, rootAbs, baseline, prepared);
  } finally {
    await prepared?.dispose();
  }
}

async function analyze(
  opts: CliOptions,
  io: RunIO,
  version: string,
  rootAbs: string,
  baseline: Report | null,
  prepared: PreparedRepo | null,
): Promise<number> {
  const progress = createProgress(!opts.quiet, io.progressStream);
  const started = performance.now();
  let walkResult;
  try {
    walkResult = await walk(rootAbs, {
      all: opts.all,
      include: opts.include,
      exclude: opts.exclude,
      onFile: (n) => progress.update(n),
    });
  } catch (err) {
    progress.stop();
    io.stderr(`jlgstat: error: cannot analyze ${opts.path}: ${errorMessage(err)}\n`);
    return EXIT_ERROR;
  }
  progress.stop();
  const durationMs = Math.round(performance.now() - started);

  const report = buildReport(walkResult, {
    toolVersion: version,
    root: prepared ? remoteRoot(prepared) : displayRoot(io.cwd, rootAbs),
    source: prepared?.source,
    all: opts.all,
    include: opts.include,
    exclude: opts.exclude,
    depth: opts.depth,
    largest: opts.largest,
    durationMs,
  });
  if (baseline !== null) report.comparison = compareReports(report, baseline, opts.compare!);

  const asJson = opts.json || (opts.output !== null && path.extname(opts.output).toLowerCase() === '.json');
  const noColorEnv = io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '';
  const content = asJson
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderTerminal(report, {
        color: opts.output === null && opts.color && !noColorEnv && io.stdoutIsTTY,
        width: opts.output === null && io.stdoutIsTTY ? (io.stdoutColumns ?? 80) : 100,
        depth: opts.depth,
      });

  if (opts.output !== null) {
    const target = path.resolve(io.cwd, opts.output);
    try {
      await atomicWrite(target, content);
    } catch (err) {
      io.stderr(`jlgstat: error: cannot write ${opts.output}: ${errorMessage(err)}\n`);
      return EXIT_ERROR;
    }
    if (!opts.quiet) io.stderr(`jlgstat: ${asJson ? 'JSON' : 'text'} report written to ${opts.output}\n`);
  } else {
    io.stdout(content);
  }

  return report.scan.complete ? EXIT_OK : EXIT_PARTIAL;
}
