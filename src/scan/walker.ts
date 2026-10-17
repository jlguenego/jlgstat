import type { Dirent, Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { classify } from '../classify/category.js';
import { extensionOf } from '../classify/extension.js';
import { AnalyzerPool } from '../read/pool.js';
import type { ExclusionBreakdown, FileRecord, ScanWarning, WarningCode } from '../report/model.js';
import { detectLanguage } from '../syntax/languages.js';
import { createLimiter, type Limiter } from '../util/semaphore.js';
import { isDefaultExcludedDir, isDefaultExcludedFile } from './defaultExcludes.js';
import { GitignoreChain, UserFilters } from './filters.js';

/** Files above this size are reported in an informational warning (§4.4). */
export const LARGE_FILE_BYTES = 50 * 1000 * 1000;

export interface WalkOptions {
  all: boolean;
  include: readonly string[];
  exclude: readonly string[];
  concurrency?: number;
  /** Worker threads for file analysis (default: CPU count - 1, max 8; 0 = in-process). */
  workers?: number;
  onFile?: (count: number) => void;
}

export interface WalkResult {
  files: FileRecord[];
  /** Traversed directories (root excluded), relative paths without trailing slash. */
  directories: string[];
  maxDepth: number;
  warnings: ScanWarning[];
  excluded: ExclusionBreakdown;
  defaultExcludedPaths: string[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

function describeError(err: unknown): string {
  const code = errorCode(err);
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code === 'ENOENT') return 'disappeared during the analysis';
  if (code === 'EBUSY') return 'file is busy or locked';
  return err instanceof Error ? err.message : String(err);
}

type EntryType = 'file' | 'dir' | 'symlink' | 'special';

function entryType(d: Dirent | Stats): EntryType {
  if (d.isSymbolicLink()) return 'symlink';
  if (d.isDirectory()) return 'dir';
  if (d.isFile()) return 'file';
  return 'special';
}

function isKnownType(d: Dirent): boolean {
  return (
    d.isFile() || d.isDirectory() || d.isSymbolicLink() || d.isFIFO() || d.isSocket() || d.isBlockDevice() || d.isCharacterDevice()
  );
}

class Walker {
  private readonly limit: Limiter;
  private readonly filters: UserFilters;
  readonly pool: AnalyzerPool;
  private rootReal = '';
  private fileCount = 0;

  readonly files: FileRecord[] = [];
  readonly directories: string[] = [];
  readonly warnings: ScanWarning[] = [];
  readonly defaultExcludedPaths: string[] = [];
  readonly excluded: ExclusionBreakdown = {
    defaultRules: 0,
    gitignore: 0,
    include: 0,
    exclude: 0,
    symlinks: 0,
    specialFiles: 0,
  };
  maxDepth = 0;

  constructor(
    private readonly rootAbs: string,
    private readonly options: WalkOptions,
  ) {
    this.limit = createLimiter(options.concurrency ?? 128);
    this.filters = new UserFilters(options.include, options.exclude);
    this.pool = new AnalyzerPool(options.workers);
  }

  async run(): Promise<void> {
    this.rootReal = await realpath(this.rootAbs);
    await this.walkDir(this.rootAbs, '', 0, GitignoreChain.empty());
  }

  private warn(code: WarningCode, relPath: string, message: string): void {
    this.warnings.push({ code, path: relPath, message });
  }

  private async walkDir(absDir: string, relDir: string, depth: number, parentChain: GitignoreChain): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await this.limit(() => readdir(absDir, { withFileTypes: true }));
    } catch (err) {
      const vanished = errorCode(err) === 'ENOENT';
      this.warn(vanished ? 'vanished-directory' : 'unreadable-directory', relDir || '.', `Cannot read directory: ${describeError(err)}`);
      return;
    }
    entries.sort((a, b) => byCodeUnit(a.name, b.name));
    const names = entries.map((e) => e.name);

    let chain = parentChain;
    if (!this.options.all && names.includes('.gitignore')) {
      try {
        const content = await this.limit(() => readFile(path.join(absDir, '.gitignore'), 'utf8'));
        chain = chain.with(relDir, content);
      } catch {
        // An unreadable .gitignore is reported when the file itself is analyzed.
      }
    }

    const tasks: Promise<void>[] = [];
    for (const entry of entries) {
      const name = entry.name;
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const abs = path.join(absDir, name);
      let type: EntryType;
      if (isKnownType(entry)) {
        type = entryType(entry);
      } else {
        try {
          type = entryType(await lstat(abs));
        } catch (err) {
          this.warn('vanished-file', rel, `Cannot inspect entry: ${describeError(err)}`);
          continue;
        }
      }

      if (type === 'dir') {
        if (this.isDirExcluded(name, rel, names, chain)) continue;
        this.directories.push(rel);
        if (depth + 1 > this.maxDepth) this.maxDepth = depth + 1;
        tasks.push(this.walkDir(abs, rel, depth + 1, chain));
      } else if (type === 'file') {
        if (this.isFileExcluded(name, rel, chain)) continue;
        tasks.push(this.limit(() => this.analyze(abs, rel, name, null)));
      } else if (type === 'symlink') {
        if (this.isFileExcluded(name, rel, chain)) continue;
        tasks.push(this.limit(() => this.handleSymlink(abs, rel, name)));
      } else {
        if (this.isFileExcluded(name, rel, chain)) continue;
        this.excluded.specialFiles++;
        this.warn('special-file-skipped', rel, 'Special file (socket, device or pipe) skipped');
      }
    }
    await Promise.all(tasks);
  }

  private isDirExcluded(name: string, rel: string, siblings: readonly string[], chain: GitignoreChain): boolean {
    if (!this.options.all) {
      if (isDefaultExcludedDir(name, siblings)) {
        this.excluded.defaultRules++;
        this.defaultExcludedPaths.push(rel);
        return true;
      }
      if (chain.ignores(`${rel}/`)) {
        this.excluded.gitignore++;
        return true;
      }
    }
    if (this.filters.excludesDir(`${rel}/`)) {
      this.excluded.exclude++;
      return true;
    }
    return false;
  }

  private isFileExcluded(name: string, rel: string, chain: GitignoreChain): boolean {
    if (!this.options.all) {
      if (isDefaultExcludedFile(name)) {
        this.excluded.defaultRules++;
        return true;
      }
      if (chain.ignores(rel)) {
        this.excluded.gitignore++;
        return true;
      }
    }
    const rejected = this.filters.rejectFile(rel);
    if (rejected !== null) {
      this.excluded[rejected]++;
      return true;
    }
    return false;
  }

  /** File symlinks are followed only when their target lies under the root. */
  private async handleSymlink(abs: string, rel: string, name: string): Promise<void> {
    let target: Stats;
    let real: string;
    try {
      target = await stat(abs);
      real = await realpath(abs);
    } catch {
      this.excluded.symlinks++;
      this.warn('symlink-broken-skipped', rel, 'Broken symbolic link skipped');
      return;
    }
    if (target.isDirectory()) {
      this.excluded.symlinks++;
      this.warn('symlink-directory-skipped', rel, 'Symbolic link to a directory not followed');
      return;
    }
    const inside = real === this.rootReal || real.startsWith(this.rootReal.endsWith(path.sep) ? this.rootReal : this.rootReal + path.sep);
    if (!inside) {
      this.excluded.symlinks++;
      this.warn('symlink-outside-root-skipped', rel, 'Symbolic link pointing outside the analyzed directory skipped');
      return;
    }
    if (!target.isFile()) {
      this.excluded.specialFiles++;
      this.warn('special-file-skipped', rel, 'Symbolic link to a special file skipped');
      return;
    }
    await this.analyze(abs, rel, name, target.size);
  }

  /** @param knownSize size from a previous stat (symlink targets), used if the file cannot be read. */
  private async analyze(abs: string, rel: string, name: string, knownSize: number | null): Promise<void> {
    const extension = extensionOf(name);
    const language = detectLanguage(name, extension);
    let bytes = knownSize ?? 0;
    try {
      const analysis = await this.pool.analyze(abs, rel, name);
      bytes = analysis.bytes;
      const c = analysis.counts;
      this.files.push({
        path: rel,
        extension,
        language: language?.name ?? null,
        bytes,
        kind: analysis.binary ? 'binary' : 'text',
        encoding: analysis.encoding,
        physicalLines: c?.physicalLines ?? null,
        nonEmptyLines: c?.nonEmptyLines ?? null,
        blankLines: c?.blankLines ?? null,
        commentLines: c?.commentLines ?? null,
        codeLines: c?.codeLines ?? null,
        category: analysis.category,
      });
      if (bytes > LARGE_FILE_BYTES) this.warn('large-file', rel, `Large file (${bytes} bytes)`);
    } catch (err) {
      if (errorCode(err) === 'ENOENT') {
        this.warn('vanished-file', rel, 'File disappeared during the analysis');
      } else {
        this.warn('unreadable-file', rel, `Cannot read file: ${describeError(err)}`);
        if (knownSize === null) bytes = await stat(abs).then((s) => s.size, () => 0);
        this.files.push({
          path: rel,
          extension,
          language: language?.name ?? null,
          bytes,
          kind: 'unreadable',
          encoding: null,
          physicalLines: null,
          nonEmptyLines: null,
          blankLines: null,
          commentLines: null,
          codeLines: null,
          category: classify({ path: rel, extension, kind: 'unreadable', language, header: null }),
        });
      }
    }
    this.fileCount++;
    this.options.onFile?.(this.fileCount);
  }
}

/** Walks `rootAbs` and analyzes every included file. Output order is deterministic. */
export async function walk(rootAbs: string, options: WalkOptions): Promise<WalkResult> {
  const walker = new Walker(rootAbs, options);
  try {
    await walker.run();
  } finally {
    await walker.pool.close();
  }
  walker.files.sort((a, b) => byCodeUnit(a.path, b.path));
  walker.directories.sort(byCodeUnit);
  walker.defaultExcludedPaths.sort(byCodeUnit);
  walker.warnings.sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.code, b.code));
  return {
    files: walker.files,
    directories: walker.directories,
    maxDepth: walker.maxDepth,
    warnings: walker.warnings,
    excluded: walker.excluded,
    defaultExcludedPaths: walker.defaultExcludedPaths,
  };
}
