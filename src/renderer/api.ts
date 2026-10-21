import type { MeyarBridge, Outcome, UpdateState } from '../contracts/bridge';
import type { Command, CommandResult, ErrorPayload } from '../contracts/commands';
import type { Query } from '../contracts/queries';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = Without<Command, 'key'>;
type QueryInput = Without<Query, never>;

/** A failed command or query with a message ready for the user and an optional field path. */
export class ApiError extends Error {
  readonly field?: string;
  readonly code: string;
  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.code = payload.code;
    if (payload.field) this.field = payload.field;
  }
}

let override: MeyarBridge | undefined;
/** Tests and previews inject an in-process bridge. */
export function setBridge(bridge: MeyarBridge | undefined) {
  override = bridge;
}
function bridge(): MeyarBridge {
  const b = override ?? window.meyar;
  if (!b) throw new ApiError({ message: 'Uçot bazasına bağlantı yoxdur.', code: 'offline' });
  return b;
}
function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new ApiError(outcome.error);
  return outcome.value;
}

/** A fresh idempotency key; reuse the same key to retry the very same request. */
export function requestKey(): string {
  return crypto.randomUUID();
}

export type Theme = 'light' | 'dark';

/** The theme is one attribute on <html>; styles.css switches every token with it. */
export function applyTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

export const api = {
  async command(command: CommandInput, key = requestKey()): Promise<CommandResult> {
    return unwrap(await bridge().command({ ...command, key }));
  },
  async query<T>(query: QueryInput): Promise<T> {
    return unwrap(await bridge().query(query)) as T;
  },
  async backup(): Promise<string | null> {
    return unwrap(await bridge().backup());
  },
  async saveFile(defaultName: string, bytes: Uint8Array): Promise<string | null> {
    return unwrap(await bridge().saveFile(defaultName, bytes));
  },
  version(): Promise<string> {
    return bridge().version();
  },
  /** Zoom of the whole page (1 = 100%); previews without the desktop bridge stay at 100%. */
  async zoom(step?: 'in' | 'out' | 'reset'): Promise<number> {
    const b = override ?? window.meyar;
    return b?.zoom ? b.zoom(step) : 1;
  },
  /** Colour theme, kept by the desktop app; previews without the bridge stay light. */
  async theme(value?: Theme): Promise<Theme> {
    const b = override ?? window.meyar;
    return b?.theme ? b.theme(value) : 'light';
  },
  onZoom(listener: (factor: number) => void): () => void {
    const b = override ?? window.meyar;
    return b?.onZoom ? b.onZoom(listener) : () => {};
  },
  setDirty(dirty: boolean) {
    bridge().setDirty(dirty);
  },
  onChanged(listener: (companyId: string) => void): () => void {
    return bridge().onChanged(listener);
  },
  /** Automatic updates (desktop app only; previews and tests have none). */
  async updateState(): Promise<UpdateState | null> {
    const b = override ?? window.meyar;
    return b?.updateState ? b.updateState() : null;
  },
  async updateInstall(): Promise<void> {
    const b = override ?? window.meyar;
    if (b?.updateInstall) await b.updateInstall();
  },
  onUpdate(listener: (state: UpdateState) => void): () => void {
    const b = override ?? window.meyar;
    return b?.onUpdate ? b.onUpdate(listener) : () => {};
  },
  /** AMB rates download (desktop app only). */
  get hasAmb(): boolean {
    return !!(override ?? window.meyar)?.ambFetch;
  },
  async ambFetch(date: string): Promise<string | null> {
    const b = bridge();
    if (!b.ambFetch) throw new Error('AMB-dən yükləmə yalnız masaüstü proqramda işləyir.');
    return unwrap(await b.ambFetch(date));
  },
  /** The DVX cabinet window exists only in the desktop app. */
  get hasDvx(): boolean {
    return !!(override ?? window.meyar)?.dvxOpen;
  },
  async dvxOpen(direction: 'sale' | 'purchase'): Promise<void> {
    const b = bridge();
    if (b.dvxOpen) unwrap(await b.dvxOpen(direction));
  },
  onDvxFile(
    listener: (file: { direction: 'sale' | 'purchase'; name: string; bytes: Uint8Array }) => void,
  ): () => void {
    const b = override ?? window.meyar;
    return b?.onDvxFile ? b.onDvxFile(listener) : () => {};
  },
  onDvxRefused(listener: (message: string) => void): () => void {
    const b = override ?? window.meyar;
    return b?.onDvxRefused ? b.onDvxRefused(listener) : () => {};
  },
};
