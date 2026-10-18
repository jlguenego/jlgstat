import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Env } from './git.js';

/** File that marks a directory as a jlgstat cache entry: only such directories are ever deleted. */
export const MARKER = 'jlgstat-entry.json';

export interface EntryMarker {
  url: string;
  key: string;
  ref: string | null;
  path: string | null;
  commit: string;
  lastUsed: string;
}

/** Cache root (§3.4): JLGSTAT_CACHE_DIR, otherwise the platform cache directory. */
export function cacheRoot(env: Env, cwd: string, platform: NodeJS.Platform = process.platform): string {
  const custom = env.JLGSTAT_CACHE_DIR;
  if (custom) return path.resolve(cwd, custom);
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'jlgstat');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'jlgstat');
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'jlgstat');
}

export const reposDir = (root: string): string => path.join(root, 'repos');
export const tmpDir = (root: string): string => path.join(root, 'tmp');

/** Directory of the kept clone of a repository, for a requested ref and subdirectory. */
export function entryDir(root: string, key: string, ref: string | null, subPath: string | null): string {
  const hash = createHash('sha256').update(`${key}#${ref ?? ''}#${subPath ?? ''}`).digest('hex').slice(0, 10);
  const slug = key
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-60);
  return path.join(reposDir(root), `${slug}-${hash}`);
}

export async function readMarker(dir: string): Promise<EntryMarker | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, MARKER), 'utf8')) as EntryMarker;
  } catch {
    return null;
  }
}

export async function writeMarker(dir: string, marker: EntryMarker): Promise<void> {
  await writeFile(path.join(dir, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function sizeOf(p: string): Promise<number> {
  let s;
  try {
    s = await lstat(p);
  } catch {
    return 0;
  }
  if (!s.isDirectory()) return s.size;
  const names = await readdir(p).catch(() => [] as string[]);
  let total = 0;
  for (const n of names) total += await sizeOf(path.join(p, n));
  return total;
}

export interface ClearResult {
  entries: number;
  bytes: number;
}

/**
 * Deletes the kept clones (all of them, or those of one repository) and, for
 * a full clear, the leftovers of interrupted runs. Directories without a
 * marker are never touched.
 */
export async function clearCache(root: string, key: string | null): Promise<ClearResult> {
  const result: ClearResult = { entries: 0, bytes: 0 };
  const names = await readdir(reposDir(root)).catch(() => [] as string[]);
  for (const name of names) {
    const dir = path.join(reposDir(root), name);
    const marker = await readMarker(dir);
    if (marker === null || (key !== null && marker.key !== key)) continue;
    result.bytes += await sizeOf(dir);
    await removeDir(dir);
    result.entries++;
  }
  if (key === null) {
    const leftovers = await readdir(tmpDir(root)).catch(() => [] as string[]);
    for (const name of leftovers) {
      const dir = path.join(tmpDir(root), name);
      if ((await readMarker(dir)) === null) continue;
      result.bytes += await sizeOf(dir);
      await removeDir(dir);
      result.entries++;
    }
  }
  return result;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
