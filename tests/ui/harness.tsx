import { Db } from '../../src/infrastructure/sqlite/db';
import { Ledger } from '../../src/application/ledger';
import { DomainError } from '../../src/domain/errors';
import type { MeyarBridge, Outcome } from '../../src/contracts/bridge';
import type { CommandResult } from '../../src/contracts/commands';
import { setBridge } from '../../src/renderer/api';
import { resetCatalogs } from '../../src/renderer/catalog';

/** In-process stand-in for the preload bridge, with the same error contract as main. */
export function harness(options: { hold?: (command: { type: string }) => boolean } = {}) {
  const db = new Db(':memory:');
  const ledger = new Ledger(db);
  const listeners = new Set<(companyId: string) => void>();
  const commands: { type: string }[] = [];
  let release: (() => void) | undefined;
  let dirty = false;
  const wrap = <T,>(fn: () => T): Outcome<T> => {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      if (e instanceof DomainError)
        return {
          ok: false,
          error: { message: e.message, code: e.code, ...(e.field ? { field: e.field } : {}) },
        };
      throw e;
    }
  };
  const bridge: MeyarBridge = {
    async command(command) {
      const c = command as { type: string; companyId?: string };
      commands.push(c);
      if (options.hold?.(c)) await new Promise<void>((resolve) => (release = resolve));
      const result = wrap(() => ledger.execute(command, { actor: 'ui-test', correlationId: 'ui' }));
      if (result.ok && !result.value.replayed)
        for (const l of listeners) l(c.companyId ?? (result.value as CommandResult).id);
      return result;
    },
    async query(query) {
      return wrap(() => ledger.query(query));
    },
    async backup() {
      return { ok: true, value: null };
    },
    async version() {
      return 'test';
    },
    setDirty(value) {
      dirty = value;
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  resetCatalogs();
  setBridge(bridge);
  let n = 0;
  const run = (cmd: object) =>
    ledger.execute(
      { key: `seed-${String(++n).padStart(6, '0')}`, ...cmd },
      { actor: 'seed', correlationId: 'seed' },
    );
  return {
    db,
    ledger,
    run,
    commands,
    release: () => release?.(),
    dirty: () => dirty,
    close() {
      setBridge(undefined);
      resetCatalogs();
      db.close();
    },
  };
}
