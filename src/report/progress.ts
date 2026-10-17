import { formatInt } from './format.js';

/**
 * Progress indicator (§6.3): nothing during the first second, then a single
 * line rewritten in place on stderr, only when stderr is a TTY and not in CI.
 * Erased before the report is printed. Never written to stdout.
 */
export interface Progress {
  update(files: number): void;
  stop(): void;
}

const NOOP: Progress = { update() {}, stop() {} };

export function createProgress(enabled: boolean, stream: NodeJS.WriteStream = process.stderr): Progress {
  if (!enabled || !stream.isTTY || process.env.CI) return NOOP;
  let files = 0;
  let shown = false;
  let interval: NodeJS.Timeout | undefined;
  const render = (): void => {
    shown = true;
    stream.write(`\r\x1b[2K${formatInt(files)} files…`);
  };
  const timer = setTimeout(() => {
    render();
    interval = setInterval(render, 100);
    interval.unref();
  }, 1000);
  timer.unref();
  return {
    update(n) {
      files = n;
    },
    stop() {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      if (shown) stream.write('\r\x1b[2K');
    },
  };
}
