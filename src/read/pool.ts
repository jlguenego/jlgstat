import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { analyzeEntry, type EntryAnalysis } from './analyzeEntry.js';
import type { WorkerRequest } from './worker.js';

/** Files analyzed in-process before worker threads are started. */
const WORKER_THRESHOLD = 300;
const MAX_WORKERS = 8;

type Pending = { resolve: (r: EntryAnalysis) => void; reject: (e: Error) => void };

interface WorkerSlot {
  worker: Worker;
  inFlight: number;
}

/**
 * Runs file analysis in-process for small trees, then spreads it over
 * worker threads once the tree proves large. Results do not depend on where
 * a file was analyzed.
 */
export class AnalyzerPool {
  private readonly workerUrl: URL | null;
  private readonly maxWorkers: number;
  private slots: WorkerSlot[] = [];
  private submitted = 0;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(workers?: number) {
    const url = new URL('./worker.js', import.meta.url);
    // Workers need the compiled worker; running from TypeScript sources (tests) stays in-process.
    this.workerUrl = existsSync(fileURLToPath(url)) ? url : null;
    const fromEnv = Number.parseInt(process.env.JLGSTAT_WORKERS ?? '', 10);
    this.maxWorkers =
      workers ?? (Number.isInteger(fromEnv) && fromEnv >= 0 ? fromEnv : Math.min(MAX_WORKERS, Math.max(0, availableParallelism() - 1)));
  }

  analyze(abs: string, rel: string, name: string): Promise<EntryAnalysis> {
    this.submitted++;
    if (this.workerUrl === null || this.maxWorkers === 0 || this.submitted <= WORKER_THRESHOLD) {
      return analyzeEntry(abs, rel, name);
    }
    if (this.slots.length === 0) this.start();
    const slot = this.slots.reduce((a, b) => (b.inFlight < a.inFlight ? b : a));
    slot.inFlight++;
    const id = this.nextId++;
    return new Promise<EntryAnalysis>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => {
          slot.inFlight--;
          resolve(r);
        },
        reject: (e) => {
          slot.inFlight--;
          reject(e);
        },
      });
      const req: WorkerRequest = { id, abs, rel, name };
      slot.worker.postMessage(req);
    });
  }

  private start(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(this.workerUrl!);
      worker.on('message', (msg: { id: number; result?: EntryAnalysis; error?: { code?: string; message: string } }) => {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else p.resolve(msg.result!);
      });
      worker.on('error', (err) => {
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
      this.slots.push({ worker, inFlight: 0 });
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
