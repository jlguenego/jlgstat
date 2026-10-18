import { parseArgs } from 'node:util';
import { CREDIT } from '../report/model.js';
import { looksLikeRepoUrl } from '../remote/url.js';

export class UsageError extends Error {}

export interface CliOptions {
  path: string;
  json: boolean;
  depth: number;
  largest: number;
  all: boolean;
  include: string[];
  exclude: string[];
  compare: string | null;
  output: string | null;
  ref: string | null;
  keepClone: boolean;
  clearCache: boolean;
  quiet: boolean;
  color: boolean;
  help: boolean;
  version: boolean;
}

export const HELP = `Usage: jlgstat [path] [options]

Quantitative X-ray of a software project: files, lines, extensions,
size distribution, largest files and directories.
No configuration, no LLM. Never modifies the analyzed files. No network access,
except to fetch a repository given by URL (with your git command and credentials).

Arguments:
  path                  Directory or Git repository URL to analyze (default: .)
                        A URL copied from the browser may name a branch and a
                        subdirectory (.../tree/<branch>/<dir>).

Options:
  --json                Write a single JSON report to stdout
  --depth <n>           Maximum depth of the directory ranking (default: 2)
  --largest <n>         Number of files in the largest-files ranking (default: 10, 0 hides it)
  --all                 Include files normally excluded (.gitignore, default exclusions)
  --include <glob>      Keep only matching files (.gitignore syntax, repeatable)
  --exclude <glob>      Exclude matching files and directories (.gitignore syntax, repeatable)
  --compare <file>      Compare with an earlier JSON snapshot
  --output <file>       Write the report to a file (.json => JSON, otherwise plain text)
  --ref <ref>           Branch, tag or full commit SHA to analyze (URL only; default: default branch)
  --keep-clone          Keep the fetched repository in the jlgstat cache (reused on the next run)
  --clear-cache         Delete the kept repositories (all, or only those of the given URL) and exit
  --quiet               No progress indicator and no confirmation on stderr
  --no-color            Disable colors (NO_COLOR is also honored)
  -h, --help            Show this help
  -v, --version         Show the version

Examples:
  npx jlgstat
  npx jlgstat ./packages/frontend --depth 3
  npx jlgstat . --include "src/**" --exclude "*.test.ts"
  npx jlgstat . --output before.json
  npx jlgstat . --compare before.json
  npx jlgstat https://github.com/owner/repo
  npx jlgstat https://github.com/owner/repo/tree/dev/src --json
  npx jlgstat git@github.com:owner/repo.git --ref v2.0.0 --keep-clone
  npx jlgstat --clear-cache

Exit codes: 0 complete analysis, 1 error, 2 partial report (unreadable files).

${CREDIT}
`;

function parseCount(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new UsageError(`option --${name} expects a non-negative integer, got "${raw}"`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new UsageError(`option --${name} is too large: ${raw}`);
  return n;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        depth: { type: 'string' },
        largest: { type: 'string' },
        all: { type: 'boolean' },
        include: { type: 'string', multiple: true },
        exclude: { type: 'string', multiple: true },
        compare: { type: 'string' },
        output: { type: 'string' },
        ref: { type: 'string' },
        'keep-clone': { type: 'boolean' },
        'clear-cache': { type: 'boolean' },
        quiet: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message.replace(/\. To specify.*$/s, ''));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError(`expected a single directory or repository URL, got ${positionals.length} paths; use --include to target specific files`);
  }
  for (const [name, value] of [
    ['compare', values.compare],
    ['output', values.output],
    ['ref', values.ref],
  ] as const) {
    if (value !== undefined && value.trim() === '') throw new UsageError(`option --${name} expects ${name === 'ref' ? 'a branch, tag or commit' : 'a file path'}`);
  }
  for (const [name, list] of [
    ['include', values.include],
    ['exclude', values.exclude],
  ] as const) {
    if (list?.some((p) => p.trim() === '')) throw new UsageError(`option --${name} expects a non-empty pattern`);
  }
  const target = positionals[0];
  const isUrl = target !== undefined && looksLikeRepoUrl(target);
  if (values['clear-cache']) {
    if (target !== undefined && !isUrl) throw new UsageError('--clear-cache accepts only a repository URL, not a local path');
    if (values.ref !== undefined || values['keep-clone']) throw new UsageError('--clear-cache cannot be combined with --ref or --keep-clone');
  } else {
    if (values.ref !== undefined && !isUrl) throw new UsageError('--ref requires a repository URL');
    if (values['keep-clone'] && !isUrl) throw new UsageError('--keep-clone requires a repository URL');
  }
  return {
    path: target ?? '.',
    json: values.json ?? false,
    depth: parseCount('depth', values.depth, 2),
    largest: parseCount('largest', values.largest, 10),
    all: values.all ?? false,
    include: values.include ?? [],
    exclude: values.exclude ?? [],
    compare: values.compare ?? null,
    output: values.output ?? null,
    ref: values.ref ?? null,
    keepClone: values['keep-clone'] ?? false,
    clearCache: values['clear-cache'] ?? false,
    quiet: values.quiet ?? false,
    color: !(values['no-color'] ?? false),
    help: values.help ?? false,
    version: values.version ?? false,
  };
}
