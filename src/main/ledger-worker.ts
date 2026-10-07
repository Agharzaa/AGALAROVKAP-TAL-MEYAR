/**
 * The ledger runs in its own thread, so a long report or import never freezes the window or
 * the main process. One worker owns the writable connection; a second, read-only worker runs
 * integrity checks beside it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { DomainError } from '../domain/errors.js';
import { Db } from '../infrastructure/sqlite/db.js';
import { Ledger } from '../application/ledger.js';
import { integrity } from '../application/reports.js';
import { systemClock } from '../application/tx.js';
import type { Outcome } from '../contracts/bridge.js';

export type WorkerOp =
  | { op: 'command'; command: unknown; actor: string; correlationId: string }
  | { op: 'query'; query: unknown }
  | { op: 'integrity'; companyId: string }
  | { op: 'backup'; target: string };
export interface WorkerRequest {
  id: number;
  body: WorkerOp;
}
export interface WorkerResponse {
  id: number;
  outcome: Outcome<unknown>;
}

const { file, readOnly } = workerData as { file: string; readOnly: boolean };
const port = parentPort!;

function fail(error: unknown): Outcome<never> {
  if (error instanceof DomainError)
    return { ok: false, error: { message: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) } };
  console.error(error);
  return {
    ok: false,
    error: { message: 'Gözlənilməz xəta baş verdi. Məlumat dəyişdirilmədi; əməliyyatı yenidən yoxlayın.', code: 'internal' },
  };
}

let db: Db;
try {
  db = new Db(file, { readOnly });
  port.postMessage({ ready: true });
} catch (error) {
  port.postMessage({ ready: false, message: error instanceof Error ? error.message : String(error) });
  process.exit(0);
}
const ledger = new Ledger(db);

port.on('message', async ({ id, body }: WorkerRequest) => {
  let outcome: Outcome<unknown>;
  try {
    switch (body.op) {
      case 'command':
        outcome = { ok: true, value: ledger.execute(body.command, { actor: body.actor, correlationId: body.correlationId }) };
        break;
      case 'query':
        outcome = { ok: true, value: ledger.query(body.query) };
        break;
      case 'integrity':
        outcome = { ok: true, value: db.read(() => integrity(db, body.companyId, systemClock.now())) };
        break;
      case 'backup':
        await db.backup(body.target);
        outcome = { ok: true, value: body.target };
        break;
    }
  } catch (error) {
    outcome = fail(error);
  }
  port.postMessage({ id, outcome } satisfies WorkerResponse);
});
