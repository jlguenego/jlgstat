import { parentPort } from 'node:worker_threads';
import { analyzeEntry } from './analyzeEntry.js';

export interface WorkerRequest {
  id: number;
  abs: string;
  rel: string;
  name: string;
}

parentPort!.on('message', (req: WorkerRequest) => {
  analyzeEntry(req.abs, req.rel, req.name).then(
    (result) => parentPort!.postMessage({ id: req.id, result }),
    (err: unknown) => {
      const e = err as { code?: unknown; message?: unknown };
      parentPort!.postMessage({
        id: req.id,
        error: { code: typeof e.code === 'string' ? e.code : undefined, message: String(e.message ?? err) },
      });
    },
  );
});
