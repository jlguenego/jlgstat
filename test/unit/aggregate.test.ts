import { describe, expect, test } from 'bun:test';
import {
  aggregateDirectories,
  distribution,
  largestDirectories,
  nearestRank,
  rankFiles,
} from '../../src/aggregate/aggregate.js';
import { formatBytes, formatInt, formatPct } from '../../src/report/format.js';
import type { FileRecord } from '../../src/report/model.js';

const file = (path: string, lines: number, bytes = lines * 10): FileRecord => ({
  path,
  extension: '.ts',
  language: 'TypeScript',
  bytes,
  kind: 'text',
  encoding: 'utf-8',
  physicalLines: lines,
  nonEmptyLines: lines,
  blankLines: 0,
  commentLines: 0,
  codeLines: lines,
  category: 'sources',
});

describe('nearest-rank percentiles (§5.3)', () => {
  // Hand-computed: rank = ceil(p/100 * N).
  const values = [15, 20, 35, 40, 50];
  test.each([
    [5, 15],
    [30, 20],
    [40, 20],
    [50, 35],
    [90, 50],
    [100, 50],
  ])('P%i = %i', (p, expected) => {
    expect(nearestRank(values, p)).toBe(expected);
  });

  test('empty input gives null', () => {
    expect(nearestRank([], 50)).toBeNull();
  });

  test('distribution of 1..100', () => {
    const files = Array.from({ length: 100 }, (_, i) => file(`f${i}.ts`, i + 1));
    const d = distribution(rankFiles(files));
    expect(d).toMatchObject({ textFiles: 100, mean: 50.5, p50: 50, p90: 90, p99: 99, max: 100, over500: 0 });
    // Top 10 = 91..100 = 955 of 5,050 lines.
    expect(d.top10LineShare).toBeCloseTo(955 / 5050, 10);
  });

  test('thresholds are strict', () => {
    const d = distribution(rankFiles([file('a', 500), file('b', 501), file('c', 1000), file('d', 1001), file('e', 5001)]));
    expect([d.over500, d.over1000, d.over5000]).toEqual([4, 2, 1]);
  });

  test('empty corpus', () => {
    expect(distribution([])).toMatchObject({ mean: null, p50: null, max: null, top10LineShare: null, over500: 0 });
  });
});

describe('directories (§5.4)', () => {
  const files = [file('README.md', 5), file('src/a.ts', 10), file('src/app/b.ts', 20), file('src/app/x/c.ts', 40), file('tests/t.ts', 7)];
  const dirs = ['src', 'src/app', 'src/app/x', 'tests', 'empty'];

  test('cumulative, without double counting at level 1', () => {
    const { directories, rootFiles } = aggregateDirectories(files, dirs);
    const get = (p: string) => directories.find((d) => d.path === p)!;
    expect(get('src')).toMatchObject({ depth: 1, files: 3, physicalLines: 70 });
    expect(get('src/app')).toMatchObject({ depth: 2, files: 2, physicalLines: 60 });
    expect(get('src/app/x')).toMatchObject({ depth: 3, files: 1, physicalLines: 40 });
    expect(get('empty')).toMatchObject({ files: 0, physicalLines: 0 });
    expect(rootFiles).toMatchObject({ files: 1, physicalLines: 5 });
    const level1 = directories.filter((d) => d.depth === 1).reduce((s, d) => s + d.physicalLines, 0);
    expect(level1 + rootFiles.physicalLines).toBe(82);
  });

  test('ranking honors depth', () => {
    const { directories } = aggregateDirectories(files, dirs);
    expect(largestDirectories(directories, 2).map((d) => d.path)).toEqual(['src', 'src/app', 'tests', 'empty']);
    expect(largestDirectories(directories, 1, 2).map((d) => d.path)).toEqual(['src', 'tests']);
  });
});

describe('number formatting (§6.1)', () => {
  test.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [1234567, '1,234,567'],
    [-1234, '-1,234'],
  ])('formatInt(%i) = %s', (n, s) => expect(formatInt(n)).toBe(s));

  test.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [1500, '1.5 kB'],
    [999_950, '1.0 MB'],
    [15_400_000, '15.4 MB'],
    [2_000_000_000, '2.0 GB'],
  ])('formatBytes(%i) = %s', (n, s) => expect(formatBytes(n)).toBe(s));

  test('percentages', () => {
    expect(formatPct(0.5714285714)).toBe('57.1%');
    expect(formatPct(null)).toBe('n/a');
  });
});
