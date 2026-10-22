import { Db } from '../../src/infrastructure/sqlite/db';
import { Ledger } from '../../src/application/ledger';
import { DomainError } from '../../src/domain/errors';
import type { MeyarBridge, Outcome, Zoom } from '../../src/contracts/bridge';
import type { CommandResult } from '../../src/contracts/commands';
import { setBridge } from '../../src/renderer/api';
import { resetCatalogs } from '../../src/renderer/catalog';

/** In-process stand-in for the preload bridge, with the same error contract as main. */
export function harness(
  options: {
    hold?: (command: { type: string }) => boolean;
    /** The fit to the window width the desktop app applies (src/main/fit-zoom.ts). */
    fit?: number;
  } = {},
) {
  const db = new Db(':memory:');
  const ledger = new Ledger(db);
  const listeners = new Set<(companyId: string) => void>();
  const commands: { type: string }[] = [];
  const saved: { name: string; bytes: Uint8Array }[] = [];
  let release: (() => void) | undefined;
  let dirty = false;
  // The DVX cabinet window: what the app asked to open, and a way to hand back an export.
  const dvxOpened: string[] = [];
  // Stage 6a diagnostics: what the main process answers (a file, or not signed in).
  const dvxDiagnoses: number[] = [];
  let dvxDiagnosis: Outcome<{ file: string; requests: number; replayed: number }> = {
    ok: false,
    error: { message: 'DVX ilə əlaqə yoxdur.', code: 'dvx' },
  };
  // cbar.az: the AMB files a test hands out, by ISO date; asked dates are recorded.
  const ambFiles = new Map<string, string>();
  const ambAsked: string[] = [];
  let dvxConnected = false;
  const dvxStateListeners = new Set<(state: { connected: boolean }) => void>();
  const dvxListeners = new Set<
    (file: { direction: 'sale' | 'purchase'; name: string; bytes: Uint8Array }) => void
  >();
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
  let theme: 'light' | 'dark' = 'light';
  // The desktop app's zoom: the user's step times the fit to the window width.
  const STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
  let zoom: Zoom = { step: 1, fit: options.fit ?? 1 };
  const zoomListeners = new Set<(zoom: Zoom) => void>();
  const setZoom = (next: Zoom) => {
    zoom = next;
    for (const l of zoomListeners) l(zoom);
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
    async saveFile(name, bytes) {
      saved.push({ name, bytes });
      return { ok: true, value: `C:\\Hesabatlar\\${name}` };
    },
    async version() {
      return 'test';
    },
    setDirty(value) {
      dirty = value;
    },
    async ambFetch(date) {
      ambAsked.push(date);
      return { ok: true, value: ambFiles.get(date) ?? null };
    },
    async theme(value) {
      if (value) theme = value;
      return theme;
    },
    async zoom(step) {
      const i = STEPS.indexOf(zoom.step);
      if (step === 'reset') setZoom({ ...zoom, step: 1 });
      else if (step === 'in' && i < STEPS.length - 1) setZoom({ ...zoom, step: STEPS[i + 1]! });
      else if (step === 'out' && i > 0) setZoom({ ...zoom, step: STEPS[i - 1]! });
      return zoom;
    },
    onZoom(listener) {
      zoomListeners.add(listener);
      return () => zoomListeners.delete(listener);
    },
    async dvxOpen(direction) {
      dvxOpened.push(direction);
      return { ok: true, value: null };
    },
    async dvxDiagnose() {
      dvxDiagnoses.push(1);
      return dvxDiagnosis;
    },
    async dvxConnected() {
      return { ok: true, value: dvxConnected };
    },
    onDvxState(listener) {
      dvxStateListeners.add(listener);
      return () => dvxStateListeners.delete(listener);
    },
    onDvxFile(listener) {
      dvxListeners.add(listener);
      return () => dvxListeners.delete(listener);
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
    saved,
    release: () => release?.(),
    dirty: () => dirty,
    theme: () => theme,
    /** As if the window was resized and the desktop app fitted the page anew. */
    refit: (fit: number) => setZoom({ ...zoom, fit }),
    dvxOpened,
    dvxDiagnoses,
    /** As if the user signed in to (or closed) the cabinet window. */
    dvxState(state: { connected: boolean }) {
      dvxConnected = state.connected;
      for (const l of dvxStateListeners) l(state);
    },
    /** What the next diagnostics request answers. */
    setDvxDiagnosis(answer: typeof dvxDiagnosis) {
      dvxDiagnosis = answer;
    },
    ambFiles,
    ambAsked,
    /** As if the user exported e-qaimələr in the cabinet window. */
    dvxExport(file: { direction: 'sale' | 'purchase'; name: string; bytes: Uint8Array }) {
      for (const l of dvxListeners) l(file);
    },
    close() {
      setBridge(undefined);
      resetCatalogs();
      db.close();
    },
  };
}
