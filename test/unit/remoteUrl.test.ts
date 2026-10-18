import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { cacheRoot, entryDir } from '../../src/remote/cache.js';
import { parseLsRemote, resolveRef, splitBrowserRest } from '../../src/remote/fetch.js';
import { looksLikeRepoUrl, parseRepoArg, redact, RemoteError } from '../../src/remote/url.js';

describe('repository URL recognition (§3.4)', () => {
  test('local paths are not URLs', () => {
    for (const p of ['.', 'src', './a/b', '../x', 'C:\\work\\repo', 'C:/work/repo', '/home/me/repo', 'git', 'a:b']) {
      expect(looksLikeRepoUrl(p)).toBe(false);
      expect(parseRepoArg(p)).toBeNull();
    }
  });

  test('schemes and the scp-like syntax are URLs', () => {
    for (const u of [
      'https://github.com/o/r',
      'HTTP://example.com/o/r',
      'ssh://git@example.com:2222/o/r.git',
      'git://example.com/o/r',
      'file:///C:/repos/r',
      'git@github.com:o/r.git',
    ]) {
      expect(looksLikeRepoUrl(u)).toBe(true);
    }
  });

  test('plain repository URL: .git suffix, trailing slash, query and fragment are normalized', () => {
    const s = parseRepoArg('https://github.com/Owner/Repo.git/?tab=readme#top')!;
    expect(s.cloneUrl).toBe('https://github.com/Owner/Repo.git');
    expect(s.displayUrl).toBe('https://github.com/Owner/Repo');
    expect(s.key).toBe('github.com/Owner/Repo');
    expect(s.browserRest).toBeNull();
  });

  test('HTTPS and scp-like URLs of one repository share the cache key', () => {
    expect(parseRepoArg('git@github.com:o/r.git')!.key).toBe(parseRepoArg('https://github.com/o/r')!.key);
    expect(parseRepoArg('git@github.com:o/r.git')!.displayUrl).toBe('git@github.com:o/r');
  });

  test('credentials are kept for git but never shown', () => {
    const s = parseRepoArg('https://user:s3cret@example.com/o/r.git')!;
    expect(s.cloneUrl).toBe('https://user:s3cret@example.com/o/r.git');
    expect(s.displayUrl).toBe('https://example.com/o/r');
    expect(s.key).not.toContain('s3cret');
    const token = parseRepoArg('https://ghp_token@github.com/o/r')!;
    expect(token.displayUrl).toBe('https://github.com/o/r');
    expect(redact("fatal: unable to access 'https://user:s3cret@example.com/o/r.git/'")).toBe(
      "fatal: unable to access 'https://example.com/o/r.git/'",
    );
  });

  test('SSH user names are kept, passwords are not', () => {
    expect(parseRepoArg('ssh://git@example.com:2222/o/r.git')!.displayUrl).toBe('ssh://git@example.com:2222/o/r');
    expect(parseRepoArg('ssh://git:pw@example.com/o/r')!.displayUrl).toBe('ssh://git@example.com/o/r');
  });

  test('GitHub browser URLs give the repository and the rest after tree/', () => {
    const s = parseRepoArg('https://github.com/o/r/tree/feature/x/src/app')!;
    expect(s.cloneUrl).toBe('https://github.com/o/r');
    expect(s.displayUrl).toBe('https://github.com/o/r');
    expect(s.browserRest).toBe('feature/x/src/app');
    expect(parseRepoArg('https://github.com/o/r/tree/main')!.browserRest).toBe('main');
  });

  test('GitLab browser URLs (subgroups, /-/tree/)', () => {
    const s = parseRepoArg('https://gitlab.com/g/sub/r/-/tree/dev/lib')!;
    expect(s.cloneUrl).toBe('https://gitlab.com/g/sub/r');
    expect(s.browserRest).toBe('dev/lib');
    expect(parseRepoArg('https://gitlab.com/g/sub/r/-/merge_requests')!.browserRest).toBeNull();
  });

  test('Bitbucket browser URLs (/src/)', () => {
    const s = parseRepoArg('https://bitbucket.org/o/r/src/main/docs/')!;
    expect(s.cloneUrl).toBe('https://bitbucket.org/o/r');
    expect(s.browserRest).toBe('main/docs');
  });

  test('a file URL (blob) is refused', () => {
    expect(() => parseRepoArg('https://github.com/o/r/blob/main/README.md')).toThrow(RemoteError);
    expect(() => parseRepoArg('https://gitlab.com/g/r/-/blob/main/a.ts')).toThrow(RemoteError);
  });

  test('a URL without repository path is refused', () => {
    expect(() => parseRepoArg('https://github.com/')).toThrow(RemoteError);
  });

  test('malformed percent-encoding is a RemoteError, without credentials', () => {
    expect(() => parseRepoArg('https://u:s3cret@github.com/o/r/tree/main/%E0%A4%A')).toThrow(/malformed encoding\): https:\/\/github\.com/);
  });

  test('a non-default port is part of the repository identity', () => {
    expect(parseRepoArg('https://example.com:8443/o/r')!.key).toBe('example.com:8443/o/r');
    expect(parseRepoArg('https://example.com:443/o/r')!.key).toBe('example.com/o/r');
    expect(parseRepoArg('ssh://git@example.com:22/o/r')!.key).toBe(parseRepoArg('git@example.com:o/r')!.key);
    expect(parseRepoArg('ssh://git@example.com:2222/o/r')!.key).toBe('example.com:2222/o/r');
  });

  test('file:// URLs keep their path for git', () => {
    const s = parseRepoArg('file:///C:/repos/r.git/')!;
    expect(s.cloneUrl).toBe('file:///C:/repos/r.git');
    expect(s.displayUrl).toBe('file:///C:/repos/r');
  });
});

describe('remote refs', () => {
  const remote = parseLsRemote(
    [
      'ref: refs/heads/main\tHEAD',
      'aaaa\tHEAD',
      'aaaa\trefs/heads/main',
      'bbbb\trefs/heads/feature/x',
      'eeee\trefs/heads/feature',
      'cccc\trefs/tags/v1.0',
      'dddd\trefs/tags/v1.0^{}',
      '',
    ].join('\n'),
  );

  test('ls-remote output', () => {
    expect(remote.defaultBranch).toBe('main');
    expect([...remote.refs].sort()).toEqual(['HEAD', 'refs/heads/feature', 'refs/heads/feature/x', 'refs/heads/main', 'refs/tags/v1.0']);
  });

  test('the longest branch or tag splits a browser path', () => {
    expect(splitBrowserRest('feature/x/src/app', remote)).toEqual({ ref: 'feature/x', path: 'src/app' });
    expect(splitBrowserRest('main', remote)).toEqual({ ref: 'main', path: null });
    expect(splitBrowserRest('v1.0/docs', remote)).toEqual({ ref: 'v1.0', path: 'docs' });
    const sha = 'a'.repeat(40);
    expect(splitBrowserRest(`${sha}/lib`, remote)).toEqual({ ref: sha, path: 'lib' });
    expect(() => splitBrowserRest('nope/src', remote)).toThrow(RemoteError);
  });

  test('ref resolution', () => {
    expect(resolveRef(null, remote)).toEqual({ name: 'main', target: 'refs/heads/main' });
    expect(resolveRef('feature/x', remote)).toEqual({ name: 'feature/x', target: 'refs/heads/feature/x' });
    expect(resolveRef('v1.0', remote)).toEqual({ name: 'v1.0', target: 'refs/tags/v1.0' });
    expect(resolveRef('refs/tags/v1.0', remote)).toEqual({ name: 'v1.0', target: 'refs/tags/v1.0' });
    const sha = 'ABCDEF0123456789abcdef0123456789abcdef01';
    expect(resolveRef(sha, remote)).toEqual({ name: sha.toLowerCase(), target: sha.toLowerCase() });
    expect(() => resolveRef('abcdef0', remote)).toThrow(/full commit SHA/);
    expect(() => resolveRef('nope', remote)).toThrow(/ref not found/);
    expect(() => resolveRef(null, parseLsRemote(''))).toThrow(/empty/);
  });
});

describe('cache location', () => {
  test('JLGSTAT_CACHE_DIR wins, relative to the working directory', () => {
    expect(cacheRoot({ JLGSTAT_CACHE_DIR: 'c' }, path.resolve('/w'), 'linux')).toBe(path.resolve('/w', 'c'));
  });

  test('platform directories', () => {
    expect(cacheRoot({ LOCALAPPDATA: 'L' }, '/', 'win32')).toBe(path.join('L', 'jlgstat'));
    expect(cacheRoot({ HOME: 'H' }, '/', 'darwin')).toBe(path.join('H', 'Library', 'Caches', 'jlgstat'));
    expect(cacheRoot({ XDG_CACHE_HOME: 'X', HOME: 'H' }, '/', 'linux')).toBe(path.join('X', 'jlgstat'));
    expect(cacheRoot({ HOME: 'H' }, '/', 'linux')).toBe(path.join('H', '.cache', 'jlgstat'));
  });

  test('one entry per repository, ref and subdirectory', () => {
    const a = entryDir('R', 'github.com/o/r', null, null);
    expect(path.basename(a)).toMatch(/^github\.com-o-r-[0-9a-f]{10}$/);
    expect(entryDir('R', 'github.com/o/r', null, null)).toBe(a);
    expect(entryDir('R', 'github.com/o/r', 'dev', null)).not.toBe(a);
    expect(entryDir('R', 'github.com/o/r', null, 'src')).not.toBe(a);
  });
});
