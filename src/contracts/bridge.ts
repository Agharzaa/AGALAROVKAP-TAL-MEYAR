/** The only surface the renderer sees. Every call is validated again in the main process. */
import type { CommandResult, ErrorPayload } from './commands.js';

/** Where the automatic update stands; see src/main/updater.ts. */
export interface UpdateState {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  version: string;
  percent: number;
  message: string;
}

/**
 * Page zoom: the user's step (Ctrl + / −, 80–150%) and the fit to the window width
 * (src/main/fit-zoom.ts). The page is drawn at their product.
 */
export interface Zoom {
  step: number;
  fit: number;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload };

export interface MeyarBridge {
  command(command: unknown): Promise<Outcome<CommandResult>>;
  query(query: unknown): Promise<Outcome<unknown>>;
  /** Asks where to save and writes a consistent database copy. Null when cancelled. */
  backup(): Promise<Outcome<string | null>>;
  version(): Promise<string>;
  /** Asks where to save and writes the bytes (report exports). Null when cancelled. */
  saveFile(defaultName: string, bytes: Uint8Array): Promise<Outcome<string | null>>;
  /** Unsaved-change state of the window, used by the close guard. */
  setDirty(dirty: boolean): void;
  /** Page zoom: one step in or out, back to 100%, or (no step) the current zoom. */
  zoom?(step?: 'in' | 'out' | 'reset'): Promise<Zoom>;
  /** Colour theme: sets it when given, returns the current one (kept between sessions). */
  theme?(value?: 'light' | 'dark'): Promise<'light' | 'dark'>;
  /** Called when the zoom changes (keyboard, mouse wheel, the status bar or a resized window). */
  onZoom?(listener: (zoom: Zoom) => void): () => void;
  /** Opens the official DVX cabinet (stage 4d); its Excel exports come back via onDvxFile. */
  dvxOpen?(direction: 'sale' | 'purchase'): Promise<Outcome<null>>;
  onDvxFile?(
    listener: (file: { direction: 'sale' | 'purchase'; name: string; bytes: Uint8Array }) => void,
  ): () => void;
  /** A download or address the cabinet window refused. */
  onDvxRefused?(listener: (message: string) => void): () => void;
  /** One day's AMB rates file from cbar.az (desktop app only); null when there is none. */
  ambFetch?(date: string): Promise<Outcome<string | null>>;
  /** Automatic update state (desktop app only). */
  updateState?(): Promise<UpdateState>;
  /** Restarts into the downloaded version (the close guard still asks about unsaved work). */
  updateInstall?(): Promise<void>;
  onUpdate?(listener: (state: UpdateState) => void): () => void;
  /** Called after any successful change, with the affected company. */
  onChanged(listener: (companyId: string) => void): () => void;
}

declare global {
  interface Window {
    meyar?: MeyarBridge;
  }
}
