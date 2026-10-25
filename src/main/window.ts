import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Outcome, Zoom } from '../contracts/bridge.js';
import type { LedgerClient } from './ledger-client.js';
import { fetchAmb } from './amb.js';
import { dvxCancel, dvxConnected, dvxDiagnose, dvxExport, openDvxPortal } from './dvx-portal.js';
import { startUpdates } from './updater.js';
import { fitZoom } from './fit-zoom.js';

export interface WindowOptions {
  ledger: LedgerClient;
  /** Read-only connection for integrity checks, so they never hold up the writer. */
  reader: LedgerClient;
  rendererFile: string;
  preloadFile: string;
  version: string;
  backup: (window: BrowserWindow) => Promise<string | null>;
  /** Where the window's size, position and zoom are kept between sessions. */
  uiFile: string;
}

/** Zoom steps (Ctrl + / Ctrl − / Ctrl 0, Ctrl + mouse wheel): readable on any screen. */
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
/** The title bar and window background of each theme (styles.css --bar, --ink, --desk). */
const THEMES = {
  light: { bar: '#d2d0ca', symbol: '#2a2a28', desk: '#c7c5be' },
  dark: { bar: '#1b1c1e', symbol: '#dcdad5', desk: '#181a1c' },
} as const;
type Theme = keyof typeof THEMES;
interface UiState {
  zoom?: number;
  theme?: Theme;
  bounds?: { x: number; y: number; width: number; height: number };
  maximized?: boolean;
}
function readUi(file: string): UiState {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as UiState;
  } catch {
    return {};
  }
}
/** Saved bounds are used only while they still fall on a connected screen. */
function visible(b: UiState['bounds']): b is NonNullable<UiState['bounds']> {
  if (!b || b.width < 600 || b.height < 400) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      b.x < a.x + a.width - 100 &&
      b.x + b.width > a.x + 100 &&
      b.y >= a.y - 20 &&
      b.y < a.y + a.height - 100
    );
  });
}

/**
 * The application has exactly one OS window. Modules and documents open as internal windows
 * inside it; any attempt to open another window or navigate away is refused.
 */
export async function createMainWindow(options: WindowOptions): Promise<BrowserWindow> {
  const appUrl = pathToFileURL(options.rendererFile).href;
  const ui = readUi(options.uiFile);
  const saveUi = (patch: UiState) => {
    Object.assign(ui, patch);
    try {
      writeFileSync(options.uiFile, JSON.stringify(ui));
    } catch {
      /* the next session simply starts with the defaults */
    }
  };
  let theme: Theme = ui.theme === 'dark' ? 'dark' : 'light';
  const window = new BrowserWindow({
    ...(visible(ui.bounds) ? ui.bounds : { width: 1440, height: 900 }),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Meyar',
    // The desk colour of the theme, so there is no white flash on start.
    backgroundColor: THEMES[theme].desk,
    autoHideMenuBar: true,
    // The app draws its own title bar (the main menu lives in it); Windows keeps the caption
    // buttons (minimize, maximize, close) and snap layouts.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: THEMES[theme].bar, symbolColor: THEMES[theme].symbol, height: 40 },
    webPreferences: {
      preload: options.preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.removeMenu();
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());

  const trusted = (event: {
    sender: Electron.WebContents;
    senderFrame: Electron.WebFrameMain | null;
  }) =>
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    event.senderFrame.url === appUrl;
  const handle = <T>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, arg: unknown) => T | Promise<T>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, arg) => {
      if (!trusted(event)) throw new Error('Untrusted sender');
      return fn(event, arg);
    });
  };
  const actor = userInfo().username || 'local';
  handle('meyar:command', async (_e, command) => {
    const result = await options.ledger.call<import('../contracts/commands.js').CommandResult>({
      op: 'command',
      command,
      actor,
      correlationId: randomUUID(),
    });
    const companyId = (command as { companyId?: unknown })?.companyId;
    if (result.ok && !result.value.replayed)
      contents.send('meyar:changed', typeof companyId === 'string' ? companyId : result.value.id);
    return result;
  });
  handle('meyar:query', (_e, query) => {
    const q = query as { type?: unknown; companyId?: unknown };
    if (q?.type === 'integrity' && typeof q.companyId === 'string')
      return options.reader.call({ op: 'integrity', companyId: q.companyId });
    return options.ledger.call({ op: 'query', query });
  });
  handle('meyar:version', () => options.version);
  handle('meyar:backup', async () => {
    try {
      return { ok: true, value: await options.backup(window) } satisfies Outcome<string | null>;
    } catch (error) {
      return {
        ok: false,
        error: { message: (error as Error).message, code: 'backup' },
      } satisfies Outcome<string | null>;
    }
  });
  handle('meyar:save-file', async (_e, arg) => {
    const { defaultName, bytes } = arg as { defaultName: string; bytes: Uint8Array };
    try {
      if (!(bytes instanceof Uint8Array) || bytes.length > 200 * 1024 * 1024)
        throw new Error('Fayl düzgün deyil.');
      const safe =
        path.basename(String(defaultName)).replace(/[<>:"/\\|?*]/g, '_') || 'hesabat.xlsx';
      const result = await dialog.showSaveDialog(window, {
        title: 'Faylı saxla',
        defaultPath: safe,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath)
        return { ok: true, value: null } satisfies Outcome<string | null>;
      await writeFile(result.filePath, bytes);
      return { ok: true, value: result.filePath } satisfies Outcome<string | null>;
    } catch (error) {
      return {
        ok: false,
        error: { message: (error as Error).message, code: 'save' },
      } satisfies Outcome<string | null>;
    }
  });
  // The DVX cabinet (stage 4d): the user signs in there; exports come back to the e-qaimə box.
  handle('meyar:dvx-open', (_e, arg) => {
    const direction = arg === 'sale' ? 'sale' : 'purchase';
    openDvxPortal(window, direction, {
      onFile: (file) => !window.isDestroyed() && contents.send('meyar:dvx-file', file),
      onRefused: (message) => !window.isDestroyed() && contents.send('meyar:dvx-refused', message),
      onConnected: (connected) =>
        !window.isDestroyed() && contents.send('meyar:dvx-state', { connected }),
    });
    return { ok: true, value: null } satisfies Outcome<null>;
  });
  handle(
    'meyar:dvx-connected',
    () => ({ ok: true, value: dvxConnected() }) satisfies Outcome<boolean>,
  );
  // Stage 6b: the cabinet's own Excel export of one box, asked by Meyar.
  handle('meyar:dvx-export', async (_e, arg) => {
    const direction = (arg as { direction?: unknown } | undefined)?.direction;
    try {
      const a = (arg ?? {}) as { direction?: unknown; from?: unknown; to?: unknown };
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (
        (a.direction !== 'sale' && a.direction !== 'purchase') ||
        typeof a.from !== 'string' ||
        typeof a.to !== 'string' ||
        !day.test(a.from) ||
        !day.test(a.to)
      )
        throw new Error('DVX sorğusu düzgün deyil.');
      const value = await dvxExport(
        a.direction,
        a.from,
        a.to,
        path.join(app.getPath('userData'), 'dvx-diagnostics'),
        app.getVersion(),
        // Stage 6c-2: the box shows which page is being taken.
        (page) => !window.isDestroyed() && contents.send('meyar:dvx-progress', { direction, page }),
      );
      return { ok: true, value } satisfies Outcome<typeof value>;
    } catch (error) {
      return {
        ok: false,
        error: { message: (error as Error).message, code: 'dvx' },
      } satisfies Outcome<never>;
    }
  });
  handle('meyar:dvx-cancel', () => {
    dvxCancel();
    return null;
  });
  // Stage 6a: the shape of the cabinet's API requests, to the user's Documents folder.
  handle('meyar:dvx-diagnose', async () => {
    try {
      const value = await dvxDiagnose(app.getPath('documents'), app.getVersion());
      return { ok: true, value } satisfies Outcome<typeof value>;
    } catch (error) {
      return {
        ok: false,
        error: { message: (error as Error).message, code: 'dvx' },
      } satisfies Outcome<never>;
    }
  });
  // AMB rates (stage 5b): one day's file from cbar.az, read by the renderer.
  handle('meyar:amb-fetch', (_e, arg) => fetchAmb(arg));
  let dirty = false;
  const onDirty = (event: Electron.IpcMainEvent, value: unknown) => {
    if (trusted(event)) dirty = value === true;
  };
  ipcMain.on('meyar:dirty', onDirty);
  window.on('close', (event) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Geri qayıt', 'Saxlamadan bağla'],
      defaultId: 0,
      cancelId: 0,
      title: 'Saxlanmamış dəyişikliklər',
      message: 'Açıq sənədlərdə saxlanmamış dəyişikliklər var.',
      detail: 'Bağlasanız, uçota alınmamış dəyişikliklər itəcək.',
    });
    if (choice === 0) event.preventDefault();
  });
  window.on('closed', () => ipcMain.removeListener('meyar:dirty', onDirty));
  // Zoom: one factor for the whole page, so windows, pointer and layout stay consistent.
  // The user's step (Ctrl + / −, shown in the status bar) times the fit to the window width.
  let zoom = ZOOMS.includes(ui.zoom ?? 1) ? (ui.zoom ?? 1) : 1;
  let fit = 1;
  const current = (): Zoom => ({ step: zoom, fit });
  const apply = () => {
    contents.setZoomFactor(zoom * fit);
    // The caption buttons stay as tall as the zoomed 40 px title bar.
    window.setTitleBarOverlay({ height: Math.round(40 * zoom * fit) });
    // The status bar shows the factor the page is drawn at, so it hears of the fit too.
    contents.send('meyar:zoom', current());
  };
  const refit = () => {
    const next = fitZoom(window.getContentBounds().width);
    if (next === fit) return;
    fit = next;
    apply();
  };
  const setZoom = (next: number) => {
    zoom = next;
    apply();
    saveUi({ zoom });
  };
  const step = (dir: 'in' | 'out' | 'reset') => {
    const i = ZOOMS.indexOf(zoom);
    if (dir === 'reset') setZoom(1);
    else if (dir === 'in' && i < ZOOMS.length - 1) setZoom(ZOOMS[i + 1]!);
    else if (dir === 'out' && i > 0) setZoom(ZOOMS[i - 1]!);
    return current();
  };
  contents.on('did-finish-load', () => {
    fit = fitZoom(window.getContentBounds().width);
    apply();
  });
  window.on('resize', refit);
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return;
    const dir =
      input.key === '+' || input.key === '=' || input.code === 'NumpadAdd'
        ? 'in'
        : input.key === '-' || input.code === 'NumpadSubtract'
          ? 'out'
          : input.key === '0' || input.code === 'Numpad0'
            ? 'reset'
            : null;
    if (dir) {
      event.preventDefault();
      step(dir);
    }
  });
  contents.on('zoom-changed', (_event, direction) => step(direction));
  handle('meyar:theme', (_e, arg) => {
    if (arg === 'light' || arg === 'dark') {
      theme = arg;
      window.setBackgroundColor(THEMES[theme].desk);
      window.setTitleBarOverlay({ color: THEMES[theme].bar, symbolColor: THEMES[theme].symbol });
      saveUi({ theme });
    }
    return theme;
  });
  handle('meyar:zoom', (_e, arg) =>
    arg === 'in' || arg === 'out' || arg === 'reset' ? step(arg) : current(),
  );
  const keepBounds = () =>
    saveUi({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
  window.on('resized', keepBounds);
  window.on('moved', keepBounds);
  window.on('maximize', keepBounds);
  window.on('unmaximize', keepBounds);
  window.once('ready-to-show', () => {
    // Accountants work full screen: the first start is maximized, later ones as left.
    if (ui.maximized ?? true) window.maximize();
    window.show();
  });
  await window.loadFile(options.rendererFile);
  // Updates from GitHub releases: checked at start and every 4 hours, installed on close.
  const updates = startUpdates(window);
  handle('meyar:update-state', () => updates.current());
  handle('meyar:update-install', () => updates.install());
  return window;
}
