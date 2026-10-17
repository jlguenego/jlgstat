import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { compareReports, loadSnapshot, SnapshotError } from '../compare/compare.js';
import { atomicWrite } from '../io/atomicWrite.js';
import { buildReport } from '../report/build.js';
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

  const rootAbs = path.resolve(io.cwd, opts.path);
  let baseline: Report | null = null;
  try {
    await checkDirectory(rootAbs, opts.path);
    if (opts.compare !== null) baseline = await loadSnapshot(path.resolve(io.cwd, opts.compare));
  } catch (err) {
    if (err instanceof UsageError || err instanceof SnapshotError) {
      io.stderr(`jlgstat: error: ${err.message}\n`);
      return EXIT_ERROR;
    }
    throw err;
  }

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
    root: displayRoot(io.cwd, rootAbs),
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
