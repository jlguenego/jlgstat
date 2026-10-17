import { createColors } from 'picocolors';
import {
  formatBytes,
  formatDuration,
  formatInt,
  formatPct,
  formatSignedBytes,
  formatSignedInt,
  formatSignedPct,
  truncatePath,
} from './format.js';
import { type Comparison, CREDIT, type Delta, type DirectoryStats, type Report, type ScanWarning, type WarningCode } from './model.js';

/** Fixed table caps (§6.2). */
const MAX_EXTENSION_ROWS = 15;
const MAX_LANGUAGE_ROWS = 15;
const MAX_DIRECTORY_ROWS = 10;
const MAX_COMPARE_ROWS = 10;
const MAX_WARNING_PATHS = 5;

export interface TerminalOptions {
  color: boolean;
  /** Target width in columns. */
  width: number;
  depth: number;
}

type Align = 'left' | 'right';
type Colors = ReturnType<typeof createColors>;

/** Renders an aligned table. The first column shrinks (left-truncated) to fit. */
function table(headers: string[], rows: string[][], align: Align[], width: number, c: Colors, indent = '  '): string[] {
  const cols = headers.length;
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const gap = 2;
  const total = indent.length + widths.reduce((s, w) => s + w, 0) + gap * (cols - 1);
  if (total > width) widths[0] = Math.max(12, widths[0]! - (total - width));
  const fmt = (cells: string[]): string =>
    indent +
    cells
      .map((cell, i) => {
        const w = widths[i]!;
        const text = i === 0 ? truncatePath(cell, w) : cell;
        return align[i] === 'right' ? text.padStart(w) : text.padEnd(w);
      })
      .join(' '.repeat(gap))
      .trimEnd();
  return [c.dim(fmt(headers)), ...rows.map(fmt)];
}

function section(title: string, c: Colors): string[] {
  return ['', c.bold(title)];
}

const WARNING_LABELS: Record<WarningCode, string> = {
  'unreadable-file': 'unreadable files',
  'unreadable-directory': 'unreadable directories',
  'vanished-file': 'files that disappeared during the analysis',
  'vanished-directory': 'directories that disappeared during the analysis',
  'large-file': 'files larger than 50 MB (counted in full)',
  'symlink-directory-skipped': 'directory symlinks not followed',
  'symlink-outside-root-skipped': 'symlinks pointing outside the analyzed directory skipped',
  'symlink-broken-skipped': 'broken symlinks skipped',
  'special-file-skipped': 'special files (sockets, devices, pipes) skipped',
};

function warningLines(warnings: readonly ScanWarning[], c: Colors): string[] {
  const groups = new Map<WarningCode, ScanWarning[]>();
  for (const w of warnings) {
    const list = groups.get(w.code) ?? [];
    list.push(w);
    groups.set(w.code, list);
  }
  const out: string[] = [];
  for (const [code, list] of groups) {
    out.push(`  ${c.yellow('!')} ${formatInt(list.length)} ${WARNING_LABELS[code]}`);
    for (const w of list.slice(0, MAX_WARNING_PATHS)) out.push(c.dim(`      ${w.path}`));
    if (list.length > MAX_WARNING_PATHS) out.push(c.dim(`      + ${formatInt(list.length - MAX_WARNING_PATHS)} more`));
  }
  return out;
}

/** Orders the selected directories as a tree, siblings by lines desc. */
function directoryTree(dirs: readonly DirectoryStats[]): DirectoryStats[] {
  const selected = new Set(dirs.map((d) => d.path));
  const children = new Map<string, DirectoryStats[]>();
  for (const d of dirs) {
    const slash = d.path.lastIndexOf('/');
    let parent = slash === -1 ? '' : d.path.slice(0, slash);
    // Attach to the nearest selected ancestor (always the parent in practice).
    while (parent !== '' && !selected.has(parent)) {
      const s = parent.lastIndexOf('/');
      parent = s === -1 ? '' : parent.slice(0, s);
    }
    const list = children.get(parent) ?? [];
    list.push(d);
    children.set(parent, list);
  }
  const out: DirectoryStats[] = [];
  const visit = (key: string): void => {
    for (const d of children.get(key) ?? []) {
      out.push(d);
      visit(d.path);
    }
  };
  visit('');
  return out;
}

function deltaCells(d: Delta, bytes = false): [string, string] {
  return [bytes ? formatSignedBytes(d.delta) : formatSignedInt(d.delta), formatSignedPct(d.relative)];
}

function comparisonLines(cmp: Comparison, width: number, c: Colors): string[] {
  const out: string[] = [];
  out.push(...section(`Comparison with ${cmp.baselineFile}`, c));
  const s = cmp.summary;
  const rows: [string, Delta, boolean][] = [
    ['Files', s.files!, false],
    ['Physical lines', s.physicalLines!, false],
    ['Non-empty lines', s.nonEmptyLines!, false],
    ['Code lines', s.codeLines!, false],
    ['Size', s.bytes!, true],
    ['Directories', s.directories!, false],
    ['Extensions', s.extensions!, false],
  ];
  out.push(
    ...table(
      ['Metric', 'Before', 'After', 'Change', 'Change %'],
      rows.map(([label, d, bytes]) => {
        const f = (v: number | null): string => (v === null ? 'n/a' : bytes ? formatBytes(v) : formatInt(v));
        return [label, f(d.before), f(d.after), ...deltaCells(d, bytes)];
      }),
      ['left', 'right', 'right', 'right', 'right'],
      width,
      c,
    ),
  );
  const changed = <T extends { physicalLines: Delta; files: Delta }>(rows: T[]): T[] =>
    rows.filter((r) => r.physicalLines.delta !== 0 || r.files.delta !== 0);

  const ext = changed(cmp.byExtension);
  if (ext.length > 0) {
    out.push('', c.bold('  Extension changes'));
    out.push(
      ...table(
        ['Extension', 'Files', 'Lines', 'Lines %'],
        ext.slice(0, MAX_COMPARE_ROWS).map((r) => [r.extension, formatSignedInt(r.files.delta), ...deltaCells(r.physicalLines)]),
        ['left', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
    if (ext.length > MAX_COMPARE_ROWS) out.push(c.dim(`  + ${formatInt(ext.length - MAX_COMPARE_ROWS)} more changed extensions`));
  }
  const cats = changed(cmp.categories);
  if (cats.length > 0) {
    out.push('', c.bold('  Category changes'));
    out.push(
      ...table(
        ['Category', 'Files', 'Lines', 'Lines %'],
        cats.map((r) => [r.category, formatSignedInt(r.files.delta), ...deltaCells(r.physicalLines)]),
        ['left', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
  }
  const dirs = changed(cmp.directories);
  if (dirs.length > 0) {
    out.push('', c.bold('  Directory changes (cumulative)'));
    out.push(
      ...table(
        ['Directory', 'Files', 'Lines', 'Lines %'],
        dirs.slice(0, MAX_COMPARE_ROWS).map((r) => [
          r.path.startsWith('./') ? r.path : `${r.path}/`,
          formatSignedInt(r.files.delta),
          ...deltaCells(r.physicalLines),
        ]),
        ['left', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
    if (dirs.length > MAX_COMPARE_ROWS) out.push(c.dim(`  + ${formatInt(dirs.length - MAX_COMPARE_ROWS)} more changed directories`));
  }
  return out;
}

export function renderTerminal(report: Report, o: TerminalOptions): string {
  const c = createColors(o.color);
  const width = Math.max(60, o.width);
  const s = report.summary;
  const scan = report.scan;
  const out: string[] = [];

  // 1. Header.
  out.push(`${c.bold(c.cyan('jlgstat'))} ${c.dim(report.toolVersion)}  ${report.root}`);
  const modeText =
    scan.mode === 'all'
      ? `${c.yellow('all')} (exhaustive: .gitignore and default exclusions not applied)`
      : 'default (.gitignore and default exclusions applied)';
  out.push(c.dim(`Mode: `) + modeText + c.dim(` · ${formatDuration(scan.durationMs)}`));
  if (scan.include.length > 0) out.push(c.dim(`Include: ${scan.include.join(', ')}`));
  if (scan.exclude.length > 0) out.push(c.dim(`Exclude: ${scan.exclude.join(', ')}`));
  if (!scan.complete) out.push(c.red('Partial analysis: some files or directories could not be read (see warnings).'));
  if (report.comparison && !report.comparison.homogeneous) {
    out.push(c.yellow(`Warning: non-homogeneous comparison: ${report.comparison.differences.join('; ')}.`));
  }

  // 2. Summary.
  out.push(...section('Summary', c));
  const kv = (k: string, v: string, extra = ''): string => `  ${k.padEnd(17)}${v.padStart(12)}${extra ? `  ${c.dim(extra)}` : ''}`;
  out.push(
    kv(
      'Files',
      formatInt(s.files),
      `${formatInt(s.textFiles)} text, ${formatInt(s.binaryFiles)} binary, ${formatInt(s.unreadableFiles)} unreadable`,
    ),
  );
  out.push(kv('Physical lines', formatInt(s.physicalLines)));
  out.push(kv('Non-empty lines', formatInt(s.nonEmptyLines), `${formatInt(s.blankLines)} blank`));
  if (s.syntaxCoveredLines > 0) {
    out.push(
      kv(
        'Code lines',
        formatInt(s.codeLines),
        `${formatInt(s.commentLines)} comment lines; recognized formats cover ${formatPct(s.syntaxCoveredLines / (s.physicalLines || 1))} of lines`,
      ),
    );
  }
  out.push(kv('Size', formatBytes(s.bytes), `${formatInt(s.bytes)} bytes`));
  out.push(kv('Directories', formatInt(s.directories), `max depth ${s.maxDepth}`));
  out.push(kv('Extensions', formatInt(s.extensions), `${formatInt(s.languages)} languages`));
  if (s.textFiles > 0) {
    out.push(
      kv(
        'Source lines',
        formatInt(s.classifiedSourceLines),
        `${formatPct(s.physicalLines > 0 ? s.classifiedSourceLines / s.physicalLines : null)} of physical lines are classified as sources`,
      ),
    );
  }
  out.push(
    kv(
      'Excluded',
      formatInt(scan.excludedCount),
      scan.excludedCount > 0 ? excludedDetail(report) : '',
    ),
  );

  // 3. Extensions.
  if (report.byExtension.length > 0) {
    out.push(...section('By extension', c));
    const shown = report.byExtension.slice(0, MAX_EXTENSION_ROWS);
    out.push(
      ...table(
        ['Extension', 'Files', 'Lines', 'Non-empty', 'Size', 'Lines %', 'Avg'],
        shown.map((e) => [
          e.extension,
          formatInt(e.files),
          formatInt(e.physicalLines),
          formatInt(e.nonEmptyLines),
          formatBytes(e.bytes),
          formatPct(e.shareOfPhysicalLines),
          e.meanLinesPerFile === null ? '-' : formatInt(e.meanLinesPerFile),
        ]),
        ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
    const rest = report.byExtension.slice(MAX_EXTENSION_ROWS);
    if (rest.length > 0) {
      const lines = rest.reduce((sum, e) => sum + e.physicalLines, 0);
      out.push(
        c.dim(
          `  + ${formatInt(rest.length)} more extensions (${formatInt(lines)} lines, ${formatPct(s.physicalLines > 0 ? lines / s.physicalLines : null)})`,
        ),
      );
    }
  }

  // 3b. Languages, only when they group several extensions (§5.2).
  if (report.byLanguage.some((l) => l.extensions.length > 1)) {
    out.push(...section('By language', c));
    out.push(
      ...table(
        ['Language', 'Extensions', 'Files', 'Lines', 'Code', 'Lines %'],
        report.byLanguage
          .slice(0, MAX_LANGUAGE_ROWS)
          .map((l) => [
            l.language,
            l.extensions.join(' '),
            formatInt(l.files),
            formatInt(l.physicalLines),
            l.codeLines === null ? '-' : formatInt(l.codeLines),
            formatPct(l.shareOfPhysicalLines),
          ]),
        ['left', 'left', 'right', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
    if (report.byLanguage.length > MAX_LANGUAGE_ROWS) {
      out.push(c.dim(`  + ${formatInt(report.byLanguage.length - MAX_LANGUAGE_ROWS)} more languages`));
    }
  }

  // 4. Distribution.
  const d = report.distribution;
  if (d.textFiles > 0) {
    out.push(...section('Distribution (physical lines per text file)', c));
    out.push(
      `  Mean ${formatInt(d.mean!)} · P50 ${formatInt(d.p50!)} · P90 ${formatInt(d.p90!)} · P99 ${formatInt(d.p99!)} · Max ${formatInt(d.max!)}`,
    );
    out.push(`  Files over 500 lines: ${formatInt(d.over500)} · over 1,000: ${formatInt(d.over1000)} · over 5,000: ${formatInt(d.over5000)}`);
    out.push(`  The 10 largest files hold ${formatPct(d.top10LineShare)} of physical lines`);
  }

  // 5. Largest files.
  if (report.largestFiles.length > 0) {
    out.push(...section(`Largest files (top ${report.largestFiles.length})`, c));
    out.push(
      ...table(
        ['Path', 'Lines', 'Size'],
        report.largestFiles.map((f) => [f.path, formatInt(f.physicalLines), formatBytes(f.bytes)]),
        ['left', 'right', 'right'],
        width,
        c,
      ),
    );
  }

  // 6. Directories.
  if (report.largestDirectories.length > 0 || report.rootFiles.files > 0) {
    out.push(...section(`Largest directories (depth ≤ ${o.depth})`, c));
    const tree = directoryTree(report.largestDirectories.slice(0, MAX_DIRECTORY_ROWS));
    const rows = tree.map((dir) => [
      `${'  '.repeat(dir.depth - 1)}${dir.path}/`,
      formatInt(dir.files),
      formatInt(dir.physicalLines),
      formatBytes(dir.bytes),
    ]);
    rows.push([
      './ (root files)',
      formatInt(report.rootFiles.files),
      formatInt(report.rootFiles.physicalLines),
      formatBytes(report.rootFiles.bytes),
    ]);
    out.push(...table(['Directory (cumulative)', 'Files', 'Lines', 'Size'], rows, ['left', 'right', 'right', 'right'], width, c));
  }

  // 7. Categories.
  const cats = report.categories.filter((cat) => cat.files > 0);
  if (cats.length > 0) {
    out.push(...section('Categories', c));
    out.push(
      ...table(
        ['Category', 'Files', 'Lines', 'Size', 'Lines %'],
        cats.map((cat) => [
          cat.category,
          formatInt(cat.files),
          formatInt(cat.physicalLines),
          formatBytes(cat.bytes),
          formatPct(cat.shareOfPhysicalLines),
        ]),
        ['left', 'right', 'right', 'right', 'right'],
        width,
        c,
      ),
    );
    out.push(c.dim('  Source lines are a proxy for potentially relevant code, not a measure of complexity.'));
  }

  if (report.comparison) out.push(...comparisonLines(report.comparison, width, c));

  // 8. Warnings and significant exclusions.
  const notes: string[] = [];
  if (scan.defaultExcludedPaths.length > 0) {
    const shown = scan.defaultExcludedPaths.slice(0, MAX_WARNING_PATHS).map((p) => `${p}/`);
    const more = scan.defaultExcludedPaths.length - shown.length;
    notes.push(`  Default exclusions: ${shown.join(', ')}${more > 0 ? `, + ${formatInt(more)} more` : ''}`);
  }
  notes.push(...warningLines(scan.warnings, c));
  if (notes.length > 0) {
    out.push(...section('Warnings and exclusions', c));
    out.push(...notes);
  }

  out.push('', c.dim(CREDIT));
  return out.join('\n') + '\n';
}

function excludedDetail(report: Report): string {
  const e = report.scan.excludedBreakdown;
  const parts: string[] = [];
  if (e.defaultRules) parts.push(`${formatInt(e.defaultRules)} default rules`);
  if (e.gitignore) parts.push(`${formatInt(e.gitignore)} .gitignore`);
  if (e.include) parts.push(`${formatInt(e.include)} --include`);
  if (e.exclude) parts.push(`${formatInt(e.exclude)} --exclude`);
  if (e.symlinks) parts.push(`${formatInt(e.symlinks)} symlinks`);
  if (e.specialFiles) parts.push(`${formatInt(e.specialFiles)} special files`);
  return `entries: ${parts.join(', ')}`;
}
