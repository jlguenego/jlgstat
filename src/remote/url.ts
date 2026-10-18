// Recognition and normalization of Git repository URLs (§3.4). Pure: no I/O.

export class RemoteError extends Error {}

export interface RepoSpec {
  /** URL handed to `git` (keeps credentials and the original `.git` suffix). */
  cloneUrl: string;
  /** Normalized URL without credentials: shown in the report and on stderr. */
  displayUrl: string;
  /** Protocol-independent identity of the repository (cache entries, --clear-cache). */
  key: string;
  /** What follows `tree/` (or `src/`) in a browser URL: `<ref>/<sub/dir>`, split later against the remote refs. */
  browserRest: string | null;
}

const SCHEME_RE = /^(https?|ssh|git|file):\/\//i;
// user@host:path, as accepted by git (scp-like syntax). A Windows path never contains `@` before `:`.
const SCP_RE = /^([^\s/@:]+)@([^\s/:]+):(?!\/\/)(\S+)$/;

/** Removes the credentials of every URL found in a text (error messages from git). */
export function redact(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1');
}

/** True when the argument has the shape of a repository URL rather than a local path. */
export function looksLikeRepoUrl(arg: string): boolean {
  return SCHEME_RE.test(arg) || SCP_RE.test(arg);
}

const stripGitSuffix = (p: string): string => p.replace(/\.git$/i, '');
const trimSlashes = (p: string): string => p.replace(/\/+$/, '');

interface BrowserSplit {
  repoPath: string;
  rest: string | null;
}

/** Splits a forge web path (`/owner/repo/tree/<ref>/<dir>`, GitLab `/-/tree/`, Bitbucket `/src/`). */
function splitBrowserPath(host: string, pathname: string, original: string): BrowserSplit {
  const p = trimSlashes(pathname);
  const gitlab = p.indexOf('/-/');
  if (gitlab > 0) {
    const repoPath = p.slice(0, gitlab);
    const m = /^\/-\/(tree|blob)(?:\/(.*))?$/.exec(p.slice(gitlab));
    if (m?.[1] === 'blob') throw new RemoteError(`${redact(original)} designates a file; give a repository or directory URL`);
    return { repoPath, rest: m?.[2] || null };
  }
  const keyword = host.toLowerCase() === 'bitbucket.org' ? '(src|tree|blob)' : '(tree|blob)';
  const m = new RegExp(`^(/[^/]+/[^/]+)/${keyword}(?:/(.*))?$`).exec(p);
  if (m) {
    if (m[2] === 'blob') throw new RemoteError(`${redact(original)} designates a file; give a repository or directory URL`);
    return { repoPath: m[1]!, rest: m[3] || null };
  }
  return { repoPath: p, rest: null };
}

/**
 * Parses a repository argument. Returns null when it is not a URL (a local
 * path); throws a RemoteError when it is a URL jlgstat cannot use.
 */
export function parseRepoArg(arg: string): RepoSpec | null {
  if (arg.startsWith('-')) return null;
  const scp = SCP_RE.exec(arg);
  if (scp && !SCHEME_RE.test(arg)) {
    const [, user, host, rawPath] = scp as unknown as [string, string, string, string];
    const repoPath = trimSlashes(rawPath);
    const clean = stripGitSuffix(repoPath).replace(/^\/+/, '');
    return {
      cloneUrl: `${user}@${host}:${repoPath}`,
      displayUrl: `${user}@${host}:${clean}`,
      key: `${host.toLowerCase()}/${clean}`,
      browserRest: null,
    };
  }
  if (!SCHEME_RE.test(arg)) return null;

  let url: URL;
  try {
    url = new URL(arg);
  } catch {
    throw new RemoteError(`invalid repository URL: ${redact(arg)}`);
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'file') {
    const repoPath = trimSlashes(url.pathname);
    if (repoPath === '') throw new RemoteError(`invalid repository URL: ${arg}`);
    return {
      cloneUrl: `file://${url.host}${repoPath}`,
      displayUrl: `file://${url.host}${stripGitSuffix(repoPath)}`,
      key: `file://${url.host.toLowerCase()}${stripGitSuffix(repoPath)}`,
      browserRest: null,
    };
  }

  const isHttp = scheme === 'http' || scheme === 'https';
  const { repoPath, rest } = isHttp ? splitBrowserPath(url.hostname, url.pathname, arg) : { repoPath: trimSlashes(url.pathname), rest: null };
  if (repoPath === '' || repoPath === '/') throw new RemoteError(`invalid repository URL (no repository path): ${redact(arg)}`);

  const auth = url.username !== '' ? `${url.username}${url.password !== '' ? `:${url.password}` : ''}@` : '';
  // Over HTTP the user name often is a token: never shown. Over SSH it is an account name (`git@`).
  const shownUser = !isHttp && url.username !== '' ? `${url.username}@` : '';
  const clean = stripGitSuffix(repoPath);
  // URL already drops the default HTTP(S) ports; 22 is the default of SSH, the same server as the scp-like form.
  const port = url.port === '' || (scheme === 'ssh' && url.port === '22') ? '' : `:${url.port}`;
  let browserRest: string | null = null;
  if (rest !== null) {
    try {
      browserRest = decodeURIComponent(rest);
    } catch {
      throw new RemoteError(`invalid repository URL (malformed encoding): ${redact(arg)}`);
    }
  }
  return {
    cloneUrl: `${scheme}://${auth}${url.host}${repoPath}`,
    displayUrl: `${scheme}://${shownUser}${url.host}${clean}`,
    key: `${url.hostname.toLowerCase()}${port}${clean}`,
    browserRest,
  };
}
