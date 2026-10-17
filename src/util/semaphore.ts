export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** Bounds the number of concurrently running async tasks. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  let queue: (() => void)[] = [];
  let head = 0;

  const next = (): void => {
    while (active < max && head < queue.length) {
      const start = queue[head]!;
      head++;
      active++;
      start();
    }
    if (head > 1024 && head * 2 > queue.length) {
      queue = queue.slice(head);
      head = 0;
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
