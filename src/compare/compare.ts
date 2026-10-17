import { readFile } from 'node:fs/promises';
import { CATEGORY_ORDER, type Category, type Comparison, type Delta, type Report, SCHEMA_VERSION } from '../report/model.js';

export class SnapshotError extends Error {}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const major = (v: string): string => v.split('.')[0] ?? '';

/** Loads and validates a baseline snapshot written by `--json`/`--output`. */
export async function loadSnapshot(file: string): Promise<Report> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new SnapshotError(`cannot read snapshot "${file}": ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new SnapshotError(`snapshot "${file}" is not valid JSON`);
  }
  if (typeof data !== 'object' || data === null || typeof (data as Report).schemaVersion !== 'string') {
    throw new SnapshotError(`snapshot "${file}" is not a jlgstat JSON report (missing schemaVersion)`);
  }
  const report = data as Report;
  if (major(report.schemaVersion) !== major(SCHEMA_VERSION)) {
    throw new SnapshotError(
      `snapshot "${file}" uses schema ${report.schemaVersion}, incompatible with schema ${SCHEMA_VERSION}`,
    );
  }
  if (typeof report.summary !== 'object' || report.summary === null || !Array.isArray(report.byExtension)) {
    throw new SnapshotError(`snapshot "${file}" is incomplete (missing summary or byExtension)`);
  }
  return report;
}

export function delta(before: number | null | undefined, after: number | null | undefined): Delta {
  const b = typeof before === 'number' ? before : null;
  const a = typeof after === 'number' ? after : null;
  const d = a !== null && b !== null ? a - b : null;
  return { before: b, after: a, delta: d, relative: d !== null && b !== null && b !== 0 ? d / b : null };
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const SUMMARY_FIELDS = [
  'files',
  'textFiles',
  'binaryFiles',
  'unreadableFiles',
  'directories',
  'bytes',
  'physicalLines',
  'nonEmptyLines',
  'codeLines',
  'commentLines',
  'classifiedSourceLines',
  'extensions',
  'languages',
] as const;

interface Triple {
  files: number;
  physicalLines: number;
  bytes: number;
}

function diffRows<K extends string>(
  before: ReadonlyMap<K, Triple>,
  after: ReadonlyMap<K, Triple>,
): { key: K; files: Delta; physicalLines: Delta; bytes: Delta }[] {
  const keys = new Set<K>([...before.keys(), ...after.keys()]);
  return [...keys].map((key) => {
    const b = before.get(key);
    const a = after.get(key);
    return {
      key,
      files: delta(b?.files ?? 0, a?.files ?? 0),
      physicalLines: delta(b?.physicalLines ?? 0, a?.physicalLines ?? 0),
      bytes: delta(b?.bytes ?? 0, a?.bytes ?? 0),
    };
  });
}

const byLineChange = <T extends { physicalLines: Delta }>(key: (t: T) => string) => (x: T, y: T): number =>
  Math.abs(y.physicalLines.delta ?? 0) - Math.abs(x.physicalLines.delta ?? 0) || byCodeUnit(key(x), key(y));

/** Compares the current report to a baseline (§8). `root` is not compared. */
export function compareReports(current: Report, baseline: Report, baselineFile: string): Comparison {
  const differences: string[] = [];
  const bs = baseline.scan ?? ({} as Report['scan']);
  if (bs.mode !== current.scan.mode) differences.push(`scan mode differs (${bs.mode ?? 'unknown'} vs ${current.scan.mode})`);
  if (!sameList(bs.defaultExcludes, current.scan.defaultExcludes)) differences.push('default exclusions differ');
  if (!sameList(bs.include, current.scan.include)) differences.push('--include filters differ');
  if (!sameList(bs.exclude, current.scan.exclude)) differences.push('--exclude filters differ');

  const summary: Record<string, Delta> = {};
  for (const field of SUMMARY_FIELDS) {
    summary[field] = delta(baseline.summary[field] as number | undefined, current.summary[field]);
  }

  const extMap = (r: Report): Map<string, Triple> => new Map((r.byExtension ?? []).map((e) => [e.extension, e]));
  const catMap = (r: Report): Map<Category, Triple> => new Map((r.categories ?? []).map((c) => [c.category, c]));
  const dirMap = (r: Report): Map<string, Triple> => {
    const m = new Map<string, Triple>((r.directories ?? []).map((d) => [d.path, d]));
    if (r.rootFiles) m.set('./ (root files)', r.rootFiles);
    return m;
  };

  const categoryRows = diffRows(catMap(baseline), catMap(current))
    .map(({ key, ...rest }) => ({ category: key, ...rest }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  return {
    baselineFile,
    baselineToolVersion: typeof baseline.toolVersion === 'string' ? baseline.toolVersion : null,
    baselineSchemaVersion: baseline.schemaVersion,
    homogeneous: differences.length === 0,
    differences,
    summary,
    byExtension: diffRows(extMap(baseline), extMap(current))
      .map(({ key, ...rest }) => ({ extension: key, ...rest }))
      .sort(byLineChange((r) => r.extension)),
    categories: categoryRows,
    directories: diffRows(dirMap(baseline), dirMap(current))
      .map(({ key, ...rest }) => ({ path: key, ...rest }))
      .sort(byLineChange((r) => r.path)),
  };
}
