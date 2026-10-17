import ignore, { type Ignore } from 'ignore';

/**
 * Globs use `.gitignore` syntax and the same engine as `.gitignore` files
 * (§3.1): case-insensitive on Windows and macOS, case-sensitive on Linux.
 */
export const CASE_INSENSITIVE_GLOBS = process.platform === 'win32' || process.platform === 'darwin';

export function createMatcher(patterns: readonly string[] | string): Ignore {
  return ignore({ ignorecase: CASE_INSENSITIVE_GLOBS, allowRelativePaths: false }).add(patterns as string[]);
}

/** A `.gitignore` file and the directory (relative, '' for the root) it lives in. */
interface GitignoreLevel {
  base: string;
  matcher: Ignore;
}

/**
 * Stack of nested `.gitignore` files from the root to the current directory.
 * Deeper files take precedence; within a file the last matching rule wins.
 */
export class GitignoreChain {
  private constructor(private readonly levels: readonly GitignoreLevel[]) {}

  static empty(): GitignoreChain {
    return new GitignoreChain([]);
  }

  with(base: string, content: string): GitignoreChain {
    return new GitignoreChain([...this.levels, { base, matcher: createMatcher(content) }]);
  }

  /** @param relPath path relative to the root; directories end with `/`. */
  ignores(relPath: string): boolean {
    let ignored = false;
    for (const { base, matcher } of this.levels) {
      const local = base === '' ? relPath : relPath.slice(base.length + 1);
      const result = matcher.test(local);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
}

/** User filters `--include` / `--exclude` (§3.2 steps 3 and 4). */
export class UserFilters {
  private readonly include: Ignore | null;
  private readonly exclude: Ignore | null;

  constructor(include: readonly string[], exclude: readonly string[]) {
    this.include = include.length > 0 ? createMatcher(include) : null;
    this.exclude = exclude.length > 0 ? createMatcher(exclude) : null;
  }

  /** `--exclude` also prunes directories. `dirPath` ends with `/`. */
  excludesDir(dirPath: string): boolean {
    return this.exclude !== null && this.exclude.ignores(dirPath);
  }

  /** Returns why a file is filtered out, or null when it is kept. */
  rejectFile(filePath: string): 'include' | 'exclude' | null {
    if (this.include !== null && !this.include.ignores(filePath)) return 'include';
    if (this.exclude !== null && this.exclude.ignores(filePath)) return 'exclude';
    return null;
  }
}
