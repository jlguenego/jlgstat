import {
  aggregateDirectories,
  byExtension,
  byLanguage,
  categories,
  distribution,
  largestDirectories,
  largestFiles,
  rankFiles,
  summarize,
} from '../aggregate/aggregate.js';
import { describeDefaultExcludes } from '../scan/defaultExcludes.js';
import { CASE_INSENSITIVE_GLOBS } from '../scan/filters.js';
import type { WalkResult } from '../scan/walker.js';
import { CREDIT, PARTIAL_WARNINGS, type Report, type RepositorySource, SCHEMA_VERSION } from './model.js';

export interface BuildOptions {
  toolVersion: string;
  root: string;
  /** Remote repository, when a URL was analyzed. */
  source?: RepositorySource;
  all: boolean;
  include: readonly string[];
  exclude: readonly string[];
  depth: number;
  largest: number;
  durationMs: number;
}

export function buildReport(walk: WalkResult, o: BuildOptions): Report {
  const summary = summarize(walk.files, walk.directories.length, walk.maxDepth);
  const ranked = rankFiles(walk.files);
  const { directories, rootFiles } = aggregateDirectories(walk.files, walk.directories);
  const e = walk.excluded;
  return {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: o.toolVersion,
    credit: CREDIT,
    root: o.root,
    ...(o.source ? { source: o.source } : {}),
    scan: {
      mode: o.all ? 'all' : 'default',
      durationMs: o.durationMs,
      complete: !walk.warnings.some((w) => PARTIAL_WARNINGS.has(w.code)),
      warnings: walk.warnings,
      excludedCount: e.defaultRules + e.gitignore + e.include + e.exclude + e.symlinks + e.specialFiles,
      excludedBreakdown: e,
      defaultExcludedPaths: walk.defaultExcludedPaths,
      defaultExcludes: o.all ? [] : describeDefaultExcludes(),
      gitignore: !o.all,
      include: [...o.include],
      exclude: [...o.exclude],
      caseInsensitiveGlobs: CASE_INSENSITIVE_GLOBS,
    },
    summary,
    byExtension: byExtension(walk.files, summary.physicalLines),
    byLanguage: byLanguage(walk.files, summary.physicalLines),
    distribution: distribution(ranked),
    largestFiles: largestFiles(ranked, o.largest),
    largestDirectories: largestDirectories(directories, o.depth),
    directories,
    rootFiles,
    categories: categories(walk.files, summary.physicalLines),
    comparison: null,
  };
}
