import {
  CATEGORY_ORDER,
  type CategoryStats,
  type DirectoryStats,
  type Distribution,
  type ExtensionStats,
  type FileRecord,
  type LanguageStats,
  type LargestFile,
  type RootFilesStats,
  type Summary,
} from '../report/model.js';

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const share = (part: number, total: number): number | null => (total > 0 ? part / total : null);

const isText = (f: FileRecord): boolean => f.kind === 'text';

export function summarize(files: readonly FileRecord[], directories: number, maxDepth: number): Summary {
  const s: Summary = {
    files: files.length,
    textFiles: 0,
    binaryFiles: 0,
    unreadableFiles: 0,
    directories,
    maxDepth,
    bytes: 0,
    physicalLines: 0,
    nonEmptyLines: 0,
    blankLines: 0,
    codeLines: 0,
    commentLines: 0,
    syntaxCoveredLines: 0,
    classifiedSourceLines: 0,
    extensions: 0,
    languages: 0,
    encodings: {},
  };
  const extensions = new Set<string>();
  const languages = new Set<string>();
  for (const f of files) {
    s.bytes += f.bytes;
    extensions.add(f.extension);
    if (f.language !== null) languages.add(f.language);
    if (f.kind === 'binary') s.binaryFiles++;
    else if (f.kind === 'unreadable') s.unreadableFiles++;
    else {
      s.textFiles++;
      s.physicalLines += f.physicalLines ?? 0;
      s.nonEmptyLines += f.nonEmptyLines ?? 0;
      s.blankLines += f.blankLines ?? 0;
      if (f.codeLines !== null && f.commentLines !== null) {
        s.codeLines += f.codeLines;
        s.commentLines += f.commentLines;
        s.syntaxCoveredLines += f.physicalLines ?? 0;
      }
      if (f.category === 'sources') s.classifiedSourceLines += f.physicalLines ?? 0;
      if (f.encoding !== null) s.encodings[f.encoding] = (s.encodings[f.encoding] ?? 0) + 1;
    }
  }
  s.extensions = extensions.size;
  s.languages = languages.size;
  s.encodings = Object.fromEntries(Object.entries(s.encodings).sort(([a], [b]) => byCodeUnit(a, b)));
  return s;
}

interface Acc {
  files: number;
  textFiles: number;
  binaryFiles: number;
  bytes: number;
  physicalLines: number;
  nonEmptyLines: number;
  commentLines: number | null;
  codeLines: number | null;
  /** Whether at least one text file contributed comment/code counts. */
  syntaxKnown: boolean;
}

const newAcc = (): Acc => ({
  files: 0,
  textFiles: 0,
  binaryFiles: 0,
  bytes: 0,
  physicalLines: 0,
  nonEmptyLines: 0,
  commentLines: 0,
  codeLines: 0,
  syntaxKnown: false,
});

function add(acc: Acc, f: FileRecord): void {
  acc.files++;
  acc.bytes += f.bytes;
  if (f.kind === 'binary') acc.binaryFiles++;
  if (!isText(f)) return;
  acc.textFiles++;
  acc.physicalLines += f.physicalLines ?? 0;
  acc.nonEmptyLines += f.nonEmptyLines ?? 0;
  if (f.commentLines !== null && f.codeLines !== null) {
    acc.syntaxKnown = true;
    acc.commentLines! += f.commentLines;
    acc.codeLines! += f.codeLines;
  }
}

function sortByLines<T extends { physicalLines: number }>(items: T[], key: (t: T) => string): T[] {
  return items.sort((a, b) => b.physicalLines - a.physicalLines || byCodeUnit(key(a), key(b)));
}

export function byExtension(files: readonly FileRecord[], totalLines: number): ExtensionStats[] {
  const map = new Map<string, Acc>();
  for (const f of files) {
    let acc = map.get(f.extension);
    if (!acc) map.set(f.extension, (acc = newAcc()));
    add(acc, f);
  }
  const rows: ExtensionStats[] = [...map].map(([extension, a]) => ({
    extension,
    files: a.files,
    textFiles: a.textFiles,
    binaryFiles: a.binaryFiles,
    bytes: a.bytes,
    physicalLines: a.physicalLines,
    nonEmptyLines: a.nonEmptyLines,
    commentLines: a.syntaxKnown ? a.commentLines : null,
    codeLines: a.syntaxKnown ? a.codeLines : null,
    shareOfPhysicalLines: share(a.physicalLines, totalLines),
    meanLinesPerFile: a.textFiles > 0 ? a.physicalLines / a.textFiles : null,
  }));
  return sortByLines(rows, (r) => r.extension);
}

export function byLanguage(files: readonly FileRecord[], totalLines: number): LanguageStats[] {
  const map = new Map<string, { acc: Acc; extensions: Set<string> }>();
  for (const f of files) {
    if (f.language === null) continue;
    let entry = map.get(f.language);
    if (!entry) map.set(f.language, (entry = { acc: newAcc(), extensions: new Set() }));
    add(entry.acc, f);
    entry.extensions.add(f.extension);
  }
  const rows: LanguageStats[] = [...map].map(([language, { acc: a, extensions }]) => ({
    language,
    extensions: [...extensions].sort(byCodeUnit),
    files: a.files,
    bytes: a.bytes,
    physicalLines: a.physicalLines,
    nonEmptyLines: a.nonEmptyLines,
    commentLines: a.syntaxKnown ? a.commentLines : null,
    codeLines: a.syntaxKnown ? a.codeLines : null,
    shareOfPhysicalLines: share(a.physicalLines, totalLines),
  }));
  return sortByLines(rows, (r) => r.language);
}

/** Nearest-rank percentile of an ascending array. */
export function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Text files sorted by physical lines desc, then path. */
export function rankFiles(files: readonly FileRecord[]): FileRecord[] {
  return files
    .filter(isText)
    .sort((a, b) => (b.physicalLines ?? 0) - (a.physicalLines ?? 0) || byCodeUnit(a.path, b.path));
}

export function distribution(ranked: readonly FileRecord[]): Distribution {
  const lines = ranked.map((f) => f.physicalLines ?? 0);
  const ascending = [...lines].reverse();
  const total = lines.reduce((s, n) => s + n, 0);
  const top10 = lines.slice(0, 10).reduce((s, n) => s + n, 0);
  return {
    textFiles: lines.length,
    mean: lines.length > 0 ? total / lines.length : null,
    p50: nearestRank(ascending, 50),
    p90: nearestRank(ascending, 90),
    p99: nearestRank(ascending, 99),
    max: lines.length > 0 ? lines[0]! : null,
    over500: lines.filter((n) => n > 500).length,
    over1000: lines.filter((n) => n > 1000).length,
    over5000: lines.filter((n) => n > 5000).length,
    top10LineShare: share(top10, total),
  };
}

export function largestFiles(ranked: readonly FileRecord[], count: number): LargestFile[] {
  return ranked.slice(0, count).map((f) => ({
    path: f.path,
    extension: f.extension,
    physicalLines: f.physicalLines ?? 0,
    bytes: f.bytes,
    category: f.category,
    encoding: f.encoding,
  }));
}

export interface DirectoryAggregation {
  directories: DirectoryStats[];
  rootFiles: RootFilesStats;
}

/** Cumulative aggregation of every traversed directory (§5.4). */
export function aggregateDirectories(files: readonly FileRecord[], dirPaths: readonly string[]): DirectoryAggregation {
  const map = new Map<string, DirectoryStats>();
  for (const p of dirPaths) {
    map.set(p, { path: p, depth: p.split('/').length, files: 0, bytes: 0, physicalLines: 0, nonEmptyLines: 0 });
  }
  const rootFiles: RootFilesStats = { files: 0, bytes: 0, physicalLines: 0, nonEmptyLines: 0 };
  for (const f of files) {
    const lines = f.physicalLines ?? 0;
    const nonEmpty = f.nonEmptyLines ?? 0;
    let slash = f.path.indexOf('/');
    if (slash === -1) {
      rootFiles.files++;
      rootFiles.bytes += f.bytes;
      rootFiles.physicalLines += lines;
      rootFiles.nonEmptyLines += nonEmpty;
      continue;
    }
    while (slash !== -1) {
      const dir = map.get(f.path.slice(0, slash));
      if (dir) {
        dir.files++;
        dir.bytes += f.bytes;
        dir.physicalLines += lines;
        dir.nonEmptyLines += nonEmpty;
      }
      slash = f.path.indexOf('/', slash + 1);
    }
  }
  return { directories: [...map.values()].sort((a, b) => byCodeUnit(a.path, b.path)), rootFiles };
}

/**
 * Directories shown in the ranking: the `limit` largest with depth <= maxDepth.
 * Because aggregation is cumulative, the selection always contains the
 * ancestors of its members (parents sort before children on ties).
 */
export function largestDirectories(dirs: readonly DirectoryStats[], maxDepth: number, limit = 10): DirectoryStats[] {
  return dirs
    .filter((d) => d.depth <= maxDepth)
    .sort((a, b) => b.physicalLines - a.physicalLines || b.files - a.files || byCodeUnit(a.path, b.path))
    .slice(0, limit);
}

export function categories(files: readonly FileRecord[], totalLines: number): CategoryStats[] {
  const rows = new Map(
    CATEGORY_ORDER.map((category) => [
      category,
      { category, files: 0, bytes: 0, physicalLines: 0, nonEmptyLines: 0, shareOfPhysicalLines: null as number | null },
    ]),
  );
  for (const f of files) {
    const r = rows.get(f.category)!;
    r.files++;
    r.bytes += f.bytes;
    r.physicalLines += f.physicalLines ?? 0;
    r.nonEmptyLines += f.nonEmptyLines ?? 0;
  }
  return [...rows.values()].map((r) => ({ ...r, shareOfPhysicalLines: share(r.physicalLines, totalLines) }));
}
