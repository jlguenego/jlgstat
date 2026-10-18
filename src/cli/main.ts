#!/usr/bin/env node
import { isatty } from 'node:tty';
import { run } from './run.js';

// All fs calls (main thread and analysis workers) share libuv's thread pool,
// 4 threads by default. Must be set before the first asynchronous fs call.
process.env.UV_THREADPOOL_SIZE ??= '16';

const write = (stream: NodeJS.WriteStream) => (text: string) => {
  stream.write(text);
};

run(process.argv.slice(2), {
  stdout: write(process.stdout),
  stderr: write(process.stderr),
  cwd: process.cwd(),
  env: process.env,
  stdoutIsTTY: process.stdout.isTTY === true,
  stdoutColumns: process.stdout.columns,
  stdinIsTTY: isatty(0),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`jlgstat: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  },
);
