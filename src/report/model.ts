// Report data model. This is the source of truth for the JSON output and
// must stay in sync with schema/jlgstat.schema.json.

export const SCHEMA_VERSION = '1.2';

/** Authorship notice shown in the help, the terminal report and the JSON report. */
export const CREDIT = 'jlgstat: an idea by Jean-Louis GUENEGO (JLG), developed with AI.';

export type ScanMode = 'default' | 'all';

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'unknown-8bit';

export type FileKind = 'text' | 'binary' | 'unreadable';

export type Category =
  | 'generated'
  | 'tests'
  | 'documentation'
  | 'configuration'
  | 'sources'
  | 'other'
  | 'unknown';

export const CATEGORY_ORDER: readonly Category[] = [
  'generated',
  'tests',
  'documentation',
  'configuration',
  'sources',
  'other',
  'unknown',
];

/** One included file, as produced by the scanner. Not serialized as-is. */
export interface FileRecord {
  /** Path relative to the analyzed root, `/` separators. */
  path: string;
  extension: string;
  language: string | null;
  bytes: number;
  kind: FileKind;
  encoding: Encoding | null;
  physicalLines: number | null;
  nonEmptyLines: number | null;
  blankLines: number | null;
  commentLines: number | null;
  codeLines: number | null;
  category: Category;
}

export type WarningCode =
  // Make the analysis partial (complete: false, exit code 2).
  | 'unreadable-file'
  | 'unreadable-directory'
  | 'vanished-file'
  | 'vanished-directory'
  // Informational only.
  | 'large-file'
  | 'symlink-directory-skipped'
  | 'symlink-outside-root-skipped'
  | 'symlink-broken-skipped'
  | 'special-file-skipped';

export const PARTIAL_WARNINGS: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'unreadable-file',
  'unreadable-directory',
  'vanished-file',
  'vanished-directory',
]);

export interface ScanWarning {
  code: WarningCode;
  path: string;
  message: string;
}

export interface ExclusionBreakdown {
  defaultRules: number;
  gitignore: number;
  include: number;
  exclude: number;
  symlinks: number;
  specialFiles: number;
}

export interface ScanInfo {
  mode: ScanMode;
  durationMs: number;
  complete: boolean;
  warnings: ScanWarning[];
  excludedCount: number;
  excludedBreakdown: ExclusionBreakdown;
  /** Paths of directories pruned by the default exclusion rules. */
  defaultExcludedPaths: string[];
  defaultExcludes: string[];
  gitignore: boolean;
  include: string[];
  exclude: string[];
  caseInsensitiveGlobs: boolean;
}

export interface Summary {
  files: number;
  textFiles: number;
  binaryFiles: number;
  unreadableFiles: number;
  directories: number;
  maxDepth: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
  blankLines: number;
  /** Sums over files whose format is recognized by the syntax table. */
  codeLines: number;
  commentLines: number;
  /** Physical lines of the files for which code/comment lines are known. */
  syntaxCoveredLines: number;
  /** Physical lines of files classified as `sources`. */
  classifiedSourceLines: number;
  extensions: number;
  languages: number;
  encodings: Record<string, number>;
}

export interface LineStats {
  files: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
  commentLines: number | null;
  codeLines: number | null;
}

export interface ExtensionStats extends LineStats {
  extension: string;
  textFiles: number;
  binaryFiles: number;
  shareOfPhysicalLines: number | null;
  meanLinesPerFile: number | null;
}

export interface LanguageStats extends LineStats {
  language: string;
  extensions: string[];
  shareOfPhysicalLines: number | null;
}

export interface Distribution {
  textFiles: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  over500: number;
  over1000: number;
  over5000: number;
  top10LineShare: number | null;
}

export interface LargestFile {
  path: string;
  extension: string;
  physicalLines: number;
  bytes: number;
  category: Category;
  encoding: Encoding | null;
}

export interface DirectoryStats {
  /** Relative path without trailing slash. */
  path: string;
  depth: number;
  files: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
}

export interface RootFilesStats {
  files: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
}

export interface CategoryStats {
  category: Category;
  files: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
  shareOfPhysicalLines: number | null;
}

export interface Delta {
  before: number | null;
  after: number | null;
  delta: number | null;
  /** delta / before; null when before is 0 or unknown. */
  relative: number | null;
}

export interface Comparison {
  baselineFile: string;
  baselineToolVersion: string | null;
  baselineSchemaVersion: string;
  homogeneous: boolean;
  differences: string[];
  summary: Record<string, Delta>;
  byExtension: { extension: string; files: Delta; physicalLines: Delta; bytes: Delta }[];
  categories: { category: Category; files: Delta; physicalLines: Delta; bytes: Delta }[];
  directories: { path: string; files: Delta; physicalLines: Delta; bytes: Delta }[];
}

/** Remote repository analyzed from a URL (schema 1.2, §7.2). */
export interface RepositorySource {
  /** Repository URL without credentials. */
  url: string;
  /** Branch, tag or commit actually analyzed (the default branch when none was requested). */
  ref: string;
  /** Full SHA of the analyzed commit. */
  commit: string;
  /** Analyzed subdirectory of the repository, or null for the whole repository. */
  path: string | null;
}

export interface Report {
  schemaVersion: string;
  toolVersion: string;
  /** Authorship notice (schema 1.1). */
  credit: string;
  root: string;
  /** Present only when a repository URL was analyzed (schema 1.2). */
  source?: RepositorySource;
  scan: ScanInfo;
  summary: Summary;
  byExtension: ExtensionStats[];
  byLanguage: LanguageStats[];
  distribution: Distribution;
  largestFiles: LargestFile[];
  /** Directories selected for the terminal ranking (depth <= --depth). */
  largestDirectories: DirectoryStats[];
  /** Every traversed directory, cumulative. */
  directories: DirectoryStats[];
  rootFiles: RootFilesStats;
  categories: CategoryStats[];
  comparison: Comparison | null;
}
