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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowedUrl, MAX_DOWNLOAD, refuseDownload, startUrl } from './dvx-policy.js';
import { OWN_REQUEST, recordDvxApi, type DvxRecorder } from './dvx-api.js';
import {
  apiUrl,
  diagnosticReport,
  maskPath,
  downloadPath,
  DVX_API_HOST,
  exportRequest,
  fileIdOf,
  hasMore,
  isXlsx,
  listPath,
  samePage,
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
  /** Signed in to the cabinet (its session key seen) or not any more (stage 6a). */
  onConnected?: (connected: boolean) => void;
}

let current:
  { window: Win; direction: DvxDirection; ses: Electron.Session; api: DvxRecorder } | undefined;
/** Set only by the smoke test in the main process (never over IPC); loopback origins only. */
let testOrigin = '';
export function setDvxTestOrigin(origin: string) {
  testOrigin = origin;
}

export function openDvxPortal(owner: Win, direction: DvxDirection, events: DvxEvents): Win {
  if (current && !current.window.isDestroyed()) {
    current.direction = direction;
    if (current.window.isMinimized()) current.window.restore();
    current.window.show();
    current.window.focus();
    return current.window;
  }
  // In-memory: no "persist:" prefix. A fresh partition per window, wiped again on close.
  const ses = sessions.fromPartition(`dvx-${randomUUID()}`);
  ses.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // A window of its own (no parent): its own taskbar button, and it does not vanish with a
  // minimized Meyar — as an owned window it did, and the user could not find it again.
  const window = new BrowserWindow({
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
  // Not owned, so closed with Meyar by hand (the sign-in must not outlive the program).
  const closeWithOwner = () => !window.isDestroyed() && window.close();
  owner.once('closed', closeWithOwner);
  window.once('closed', () => !owner.isDestroyed() && owner.off('closed', closeWithOwner));
  const api = recordDvxApi(
    ses,
    () => testOrigin,
    (connected) => events.onConnected?.(connected),
  );
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
  /** What went wrong in an automatic update (stage 6b), written with the rest. */
  extra: Replay[] = [],
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
  const replays: Replay[] = [...extra];
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

/** At most 100 pages of 100 e-qaimələr in one update. */
const MAX_PAGES = 100;
let running: AbortController | undefined;

class ExportError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Stage 6b: the cabinet's own Excel export of one box (purchase: Gələnlər, sale: Göndərilənlər)
 * for a period, asked by Meyar with the portal's session key through the cabinet's session —
 * the same file the user downloads with "Exceli endir → Qaimələr üzrə", read by the same reader.
 * When DVX answers something else, the diagnostics (no values) are written to `diagDir` by
 * themselves, so the cause can be read without asking the user.
 */
export async function dvxExport(
  direction: DvxDirection,
  from: string,
  to: string,
  diagDir: string,
  version: string,
  onPage: (page: number) => void = () => {},
): Promise<{ files: { name: string; bytes: Uint8Array }[]; partial: boolean; cancelled: boolean }> {
  const state = current;
  const token = state && !state.window.isDestroyed() ? state.api.token() : '';
  if (!state || !token)
    throw new Error(
      'DVX ilə əlaqə yoxdur: "DVX kabinetini aç" ilə daxil olun və yenidən yoxlayın.',
    );
  const origin = testOrigin || `https://${DVX_API_HOST}`;
  // The portal's own filter of this box, when its list was opened in this session.
  const list = listPath(direction);
  const template = state.api
    .seen()
    .filter((r) => r.method === 'POST' && maskPath(r.url).split('?')[0] === list)
    .at(-1)?.body;
  let request = exportRequest(direction, from, to, 0, template);
  // Stage 6c-2: "Ləğv et" stops the export; the pages taken so far are answered.
  const stop = new AbortController();
  running?.abort();
  running = stop;
  const ask = (url: string, init: { method: string; body?: string }) =>
    state.ses.fetch(url, {
      ...init,
      headers: {
        accept: 'application/json, text/plain, */*',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        'x-authorization': `Bearer ${token}`,
        [OWN_REQUEST]: '1',
      },
      redirect: 'error',
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(120_000)]),
    });
  const refused = (step: string, status: number) =>
    status === 401 || status === 403
      ? new ExportError(
          'DVX sessiyasının vaxtı bitib: kabinetə yenidən daxil olun və yenidən yoxlayın.',
          step,
          status,
        )
      : new ExportError(
          `DVX ixracı alınmadı (cavab ${status}). Hələlik kabinetdə "Exceli endir" ilə davam edin.`,
          step,
          status,
        );
  const box = direction === 'purchase' ? 'Gelenler' : 'Gonderilenler';
  const files: { name: string; bytes: Uint8Array }[] = [];
  // DVX could not say whether more pages follow: the update says it is partial (audit 2026-10-25).
  let partial = false;
  try {
    for (let page = 0; page < MAX_PAGES && !stop.signal.aborted; page++) {
      onPage(page + 1);
      request = exportRequest(direction, from, to, page, template);
      const res = await ask(origin + request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });
      if (!res.ok) throw refused('export', res.status);
      const type = res.headers.get('content-type') ?? '';
      let bytes: Uint8Array;
      if (/json|text/i.test(type)) {
        const text = await res.text();
        let answer: unknown = text;
        try {
          answer = JSON.parse(text);
        } catch {
          // A plain-text id.
        }
        const id = fileIdOf(answer);
        if (!id)
          throw new ExportError(
            'DVX ixracı gözlənilməyən cavab verdi. Hələlik kabinetdə "Exceli endir" ilə davam edin.',
            'export-answer',
            res.status,
          );
        const file = await ask(origin + downloadPath(id), { method: 'GET' });
        if (!file.ok) throw refused('download', file.status);
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        // The file itself, without an id.
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      if (bytes.length > MAX_DOWNLOAD)
        throw new ExportError('DVX faylı 50 MB-dan böyükdür.', 'download-size');
      if (!isXlsx(bytes))
        throw new ExportError(
          'DVX-dən Excel faylı gəlmədi. Hələlik kabinetdə "Exceli endir" ilə davam edin.',
          'download-type',
        );
      // The same file as the page before: the export ignores paging — it is all there.
      if (samePage(files.at(-1)?.bytes, bytes)) break;
      files.push({ name: `DVX-${box}-${from}_${to}-${page + 1}.xlsx`, bytes });
      // The same page of the list says whether another one follows. If the list cannot say,
      // the pages taken so far stand (a repeated update takes the rest: one e-qaimə, once).
      const more = await ask(origin + list, { method: 'POST', body: JSON.stringify(request.body) });
      const answer: unknown = more.ok ? await more.json().catch(() => undefined) : undefined;
      if (answer === undefined) {
        partial = true;
        break;
      }
      if (!hasMore(answer)) break;
    }
    return { files, partial, cancelled: stop.signal.aborted };
  } catch (error) {
    if (stop.signal.aborted) return { files, partial, cancelled: true };
    const e =
      error instanceof ExportError
        ? error
        : new ExportError(`DVX ilə əlaqə alınmadı: ${(error as Error).message}`, 'network');
    // The cause, for the developers, without values (Meyar's data folder).
    try {
      await mkdir(diagDir, { recursive: true });
      await dvxDiagnose(diagDir, version, new Date(), [
        {
          path: `${request.path} → ${e.step}`,
          ...(e.status ? { status: e.status } : {}),
          error: e.message,
        },
      ]);
    } catch {
      // The update failed already; the diagnostics are a help only.
    }
    throw e;
  } finally {
    if (running === stop) running = undefined;
  }
}

/** Stage 6c-2: stops the running export ("Ləğv et"). */
export function dvxCancel(): void {
  running?.abort();
}

/** Signed in to the cabinet now: its window is open and the portal's session key was seen. */
export function dvxConnected(): boolean {
  return !!current && !current.window.isDestroyed() && !!current.api.token();
}

/** Smoke test only: the cabinet window, when open. */
export function dvxPortalWindow(): Win | undefined {
  return current && !current.window.isDestroyed() ? current.window : undefined;
}
