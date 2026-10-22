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
 *
 * Stage 6a: the cabinet's own API requests are watched in this session (src/main/dvx-api.ts); the
 * diagnostics file (docs/MERHELE-6-DVX-AVTOMAT.md §7) holds their shape, never a value.
 */
import { BrowserWindow, session as sessions, type BrowserWindow as Win } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedUrl, MAX_DOWNLOAD, refuseDownload, startUrl } from './dvx-policy.js';
import { OWN_REQUEST, recordDvxApi, type DvxRecorder } from './dvx-api.js';
import {
  apiUrl,
  diagnosticReport,
  maskPath,
  replayable,
  replayBody,
  type Replay,
} from './dvx-api-policy.js';

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

let current:
  { window: Win; direction: DvxDirection; ses: Electron.Session; api: DvxRecorder } | undefined;
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
  const api = recordDvxApi(ses, () => testOrigin);
  const state = { window, direction, ses, api };
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
    // A size the server did not announce is watched while it arrives (QERARLAR 2026-10-16 §5).
    item.on('updated', () => {
      if (item.getReceivedBytes() > MAX_DOWNLOAD && item.getState() === 'progressing') {
        item.cancel();
        events.onRefused(`“${name}” 50 MB-dan böyükdür; endirmə dayandırıldı.`);
      }
    });
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
    api.forget();
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

const NOT_SIGNED_IN =
  'DVX ilə əlaqə yoxdur. Əvvəlcə "DVX kabinetini aç" ilə daxil olun və e-qaimələr siyahısını (Gələnlər / Göndərilənlər) açın.';

/**
 * Stage 6a diagnostics: the shape of the cabinet's API requests seen so far, and of one small page
 * of each e-qaimə list the portal asked for, repeated by Meyar with the portal's own filter. Written
 * to `dir`; the file holds no value and no key (dvx-api-policy.ts).
 */
export async function dvxDiagnose(
  dir: string,
  version: string,
  now = new Date(),
): Promise<{ file: string; requests: number; replayed: number }> {
  const state = current;
  const token = state && !state.window.isDestroyed() ? state.api.token() : '';
  if (!state || !token) throw new Error(NOT_SIGNED_IN);
  const seen = state.api.seen();
  // The last filter the portal sent for each list.
  const lists = new Map<string, { url: string; body: Record<string, unknown> }>();
  for (const r of seen) {
    const listPath = maskPath(r.url).split('?')[0]!;
    const body = replayBody(r.body);
    if (replayable(r.method, listPath) && body && apiUrl(r.url, testOrigin))
      lists.set(listPath, { url: r.url, body });
  }
  const replays: Replay[] = [];
  for (const [listPath, { url, body }] of lists) {
    try {
      const res = await state.ses.fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authorization': `Bearer ${token}`,
          [OWN_REQUEST]: '1',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401) {
        replays.push({ path: listPath, status: 401, error: 'Sessiyanın vaxtı bitib' });
        continue;
      }
      const json = /json/i.test(res.headers.get('content-type') ?? '');
      replays.push(
        json
          ? { path: listPath, status: res.status, response: await res.json() }
          : { path: listPath, status: res.status, error: 'Cavab JSON deyil' },
      );
    } catch (error) {
      replays.push({ path: listPath, error: (error as Error).name || 'Sorğu alınmadı' });
    }
  }
  const report = diagnosticReport(seen, replays, version, now);
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const file = path.join(dir, `Meyar-DVX-quruluş-${stamp}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return { file, requests: report.requests.length, replayed: replays.length };
}
