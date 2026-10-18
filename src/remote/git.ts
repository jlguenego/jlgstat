import { spawn } from 'node:child_process';
import { redact, RemoteError } from './url.js';

export type Env = Record<string, string | undefined>;

/** Variables that would redirect git to another repository than the one jlgstat manages. */
const REPOSITORY_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
];

/**
 * Environment of the git processes: the user's environment (credentials,
 * proxy, SSH agent), without repository overrides, never smudging LFS
 * pointers, and without terminal prompts when nobody can answer them.
 */
export function gitEnv(env: Env, interactive: boolean): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) {
    if (!REPOSITORY_VARIABLES.includes(k.toUpperCase())) out[k] = v;
  }
  out.GIT_LFS_SKIP_SMUDGE = '1';
  if (!interactive) out.GIT_TERMINAL_PROMPT = '0';
  return out;
}

export class GitNotFoundError extends RemoteError {}

/** Runs `git` and resolves with its stdout; rejects with a RemoteError whose message has no credentials. */
export function runGit(args: readonly string[], env: Env, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e: NodeJS.ErrnoException) => {
      reject(
        e.code === 'ENOENT'
          ? new GitNotFoundError('git is required to analyze a repository URL but was not found in PATH')
          : new RemoteError(`cannot run git: ${e.message}`),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString('utf8'));
        return;
      }
      const stderr = redact(Buffer.concat(err).toString('utf8'))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('hint:'));
      reject(new RemoteError(stderr.join(' / ') || `git exited with code ${code}`));
    });
  });
}
