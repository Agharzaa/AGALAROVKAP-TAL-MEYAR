/**
 * The DVX cabinet inside Meyar (stage 4d; docs/MERHELE-4-EQAIME.md §7; QERARLAR 2026-10-15,
 * mərhələ 4 §1–§2).
 *
 * The official e-taxes.gov.az page in its own window. The user signs in there — ASAN İmza, SİMA
 * or user code + password + PIN — exactly as in a browser: Meyar injects no script, has no
 * preload in this window, reads no field and stores nothing typed there. The session lives in
 * memory only (a partition without "persist:") and is wiped when the window closes. When the user
 * exports e-qaimələr to Excel with the cabinet's own button, the file is handed to the e-qaimə
 * box for the usual preview; it passes through a temporary file that is deleted at once
 * (Electron has no in-memory download).
 */
import { BrowserWindow, session as sessions, type BrowserWindow as Win } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedUrl, refuseDownload, startUrl } from './dvx-policy.js';

export type DvxDirection = 'sale' | 'purchase';
export interface DvxFile {
  direction: DvxDirection;
  name: string;
  bytes: Uint8Array;
}
export interface DvxEvents {
  /** An export arrived (already read into memory, its temporary file deleted). */
  onFile: (file: DvxFile) => void;
  /** A download or a navigation was refused (shown to the user in the box). */
  onRefused: (message: string) => void;
}

let current: { window: Win; direction: DvxDirection; ses: Electron.Session } | undefined;
/** Set only by the smoke test in the main process (never over IPC); loopback origins only. */
let testOrigin = '';
export function setDvxTestOrigin(origin: string) {
  testOrigin = origin;
}

export function openDvxPortal(parent: Win, direction: DvxDirection, events: DvxEvents): Win {
  if (current && !current.window.isDestroyed()) {
    current.direction = direction;
    current.window.focus();
    return current.window;
  }
  // In-memory: no "persist:" prefix. A fresh partition per window, wiped again on close.
  const ses = sessions.fromPartition(`dvx-${randomUUID()}`);
  ses.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    parent,
    width: 1280,
    height: 900,
    title: 'DVX kabineti — e-taxes.gov.az',
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.removeMenu();
  const state = { window, direction, ses };
  current = state;
  const contents = window.webContents;
  const allowed = (url: string) => allowedUrl(url, testOrigin);
  // Links that open a new window stay in this one (v1.17: one window for the whole journey).
  contents.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) setImmediate(() => !window.isDestroyed() && void window.loadURL(url));
    else events.onRefused(`Kabinetdən kənar ünvan açılmadı: ${url}`);
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string) => {
    if (allowed(url)) return;
    event.preventDefault();
    events.onRefused(`Kabinetdən kənar ünvan açılmadı: ${url}`);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());

  ses.on('will-download', (_event, item) => {
    const name = path.basename(item.getFilename());
    const url = item.getURL();
    // The cabinet may build the file in the page (blob:/data:); a link must be its own site.
    const source = url.startsWith('blob:') ? url.slice(5) : url;
    const fromCabinet = url.startsWith('data:') || allowed(source);
    const why =
      refuseDownload(name, item.getTotalBytes()) ||
      (fromCabinet ? '' : `Fayl kabinetdən kənar ünvandan gəlir: ${url}`);
    if (why) {
      item.cancel();
      events.onRefused(why);
      return;
    }
    const temp = path.join(tmpdir(), `meyar-dvx-${randomUUID()}${path.extname(name)}`);
    item.setSavePath(temp);
    item.once('done', (_e, outcome) => {
      void (async () => {
        try {
          if (outcome !== 'completed') return;
          const bytes = new Uint8Array(await readFile(temp));
          const late = refuseDownload(name, bytes.length);
          if (late) events.onRefused(late);
          else events.onFile({ direction: state.direction, name, bytes });
        } catch (error) {
          events.onRefused(`Fayl oxunmadı: ${(error as Error).message}`);
        } finally {
          await rm(temp, { force: true });
        }
      })();
    });
  });

  window.on('closed', () => {
    if (current === state) current = undefined;
    // Sign-out: cookies, storage and cache of the cabinet are gone with the window.
    void ses.clearStorageData();
    void ses.clearCache();
  });
  void window.loadURL(startUrl(testOrigin));
  return window;
}

/**
 * Smoke test: closes the cabinet window and reports the cookies left in its session afterwards
 * (none: the sign-in does not outlive the window).
 */
export async function closeDvxPortal(): Promise<number | null> {
  const state = current;
  if (!state || state.window.isDestroyed()) return null;
  const done = new Promise<void>((resolve) => state.window.once('closed', () => resolve()));
  state.window.close();
  await done;
  await state.ses.clearStorageData();
  return (await state.ses.cookies.get({})).length;
}
