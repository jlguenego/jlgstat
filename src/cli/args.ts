import { parseArgs } from 'node:util';
import { CREDIT } from '../report/model.js';

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
  quiet: boolean;
  color: boolean;
  help: boolean;
  version: boolean;
}

export const HELP = `Usage: jlgstat [path] [options]

Quantitative X-ray of a software project: files, lines, extensions,
size distribution, largest files and directories.
No configuration, no network, no LLM. Never modifies the analyzed files.

Arguments:
  path                  Directory to analyze (default: .)

Options:
  --json                Write a single JSON report to stdout
  --depth <n>           Maximum depth of the directory ranking (default: 2)
  --largest <n>         Number of files in the largest-files ranking (default: 10, 0 hides it)
  --all                 Include files normally excluded (.gitignore, default exclusions)
  --include <glob>      Keep only matching files (.gitignore syntax, repeatable)
  --exclude <glob>      Exclude matching files and directories (.gitignore syntax, repeatable)
  --compare <file>      Compare with an earlier JSON snapshot
  --output <file>       Write the report to a file (.json => JSON, otherwise plain text)
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
    throw new UsageError(`expected a single directory, got ${positionals.length} paths; use --include to target specific files`);
  }
  for (const [name, value] of [
    ['compare', values.compare],
    ['output', values.output],
  ] as const) {
    if (value !== undefined && value.trim() === '') throw new UsageError(`option --${name} expects a file path`);
  }
  for (const [name, list] of [
    ['include', values.include],
    ['exclude', values.exclude],
  ] as const) {
    if (list?.some((p) => p.trim() === '')) throw new UsageError(`option --${name} expects a non-empty pattern`);
  }
  return {
    path: positionals[0] ?? '.',
    json: values.json ?? false,
    depth: parseCount('depth', values.depth, 2),
    largest: parseCount('largest', values.largest, 10),
    all: values.all ?? false,
    include: values.include ?? [],
    exclude: values.exclude ?? [],
    compare: values.compare ?? null,
    output: values.output ?? null,
    quiet: values.quiet ?? false,
    color: !(values['no-color'] ?? false),
    help: values.help ?? false,
    version: values.version ?? false,
  };
}
