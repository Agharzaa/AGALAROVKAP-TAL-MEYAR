import { Worker } from 'node:worker_threads';
import type { Outcome } from '../contracts/bridge.js';
import type { WorkerOp, WorkerResponse } from './ledger-worker.js';

/** Promise-based handle to a ledger worker thread. */
export class LedgerClient {
  private readonly worker: Worker;
  private next = 1;
  private exited = false;
  private readonly pending = new Map<number, (o: Outcome<unknown>) => void>();
  readonly ready: Promise<void>;
  constructor(script: string, file: string, readOnly = false) {
    this.worker = new Worker(script, { workerData: { file, readOnly } });
    this.ready = new Promise((resolve, reject) => {
      const onFirst = (m: { ready?: boolean; message?: string }) => {
        if (m.ready === undefined) return;
        this.worker.off('message', onFirst);
        if (m.ready) resolve();
        else reject(new Error(m.message ?? 'Uçot bazası açılmadı.'));
      };
      this.worker.on('message', onFirst);
      this.worker.once('error', reject);
    });
    this.worker.on('message', (m: WorkerResponse) => {
      if (typeof m.id !== 'number') return;
      const done = this.pending.get(m.id);
      this.pending.delete(m.id);
      done?.(m.outcome);
    });
    this.worker.on('exit', () => {
      this.exited = true;
      for (const done of this.pending.values())
        done({
          ok: false,
          error: { message: 'Uçot modulu dayandı. Proqramı yenidən açın.', code: 'internal' },
        });
      this.pending.clear();
    });
  }
  call<T = unknown>(body: WorkerOp): Promise<Outcome<T>> {
    const id = this.next++;
    if (this.exited)
      return Promise.resolve({
        ok: false,
        error: { message: 'Uçot modulu dayandı. Proqramı yenidən açın.', code: 'internal' },
      });
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (o: Outcome<unknown>) => void);
      this.worker.postMessage({ id, body });
    });
  }
  terminate() {
    return this.worker.terminate();
  }
}
