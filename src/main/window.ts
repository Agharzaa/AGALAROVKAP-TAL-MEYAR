import { BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Outcome } from '../contracts/bridge.js';
import type { LedgerClient } from './ledger-client.js';

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
interface UiState {
  zoom?: number;
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
  const window = new BrowserWindow({
    ...(visible(ui.bounds) ? ui.bounds : { width: 1440, height: 900 }),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Meyar',
    backgroundColor: '#f3f3f3',
    autoHideMenuBar: true,
    // Windows 11 look: the app draws its own title bar; Windows keeps the caption buttons
    // (minimize, maximize, close) and snap layouts.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f3f3f3', symbolColor: '#1b1b1b', height: 40 },
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
  let zoom = ZOOMS.includes(ui.zoom ?? 1) ? (ui.zoom ?? 1) : 1;
  const setZoom = (next: number) => {
    zoom = next;
    contents.setZoomFactor(zoom);
    contents.send('meyar:zoom', zoom);
    saveUi({ zoom });
  };
  const step = (dir: 'in' | 'out' | 'reset') => {
    const i = ZOOMS.indexOf(zoom);
    if (dir === 'reset') setZoom(1);
    else if (dir === 'in' && i < ZOOMS.length - 1) setZoom(ZOOMS[i + 1]!);
    else if (dir === 'out' && i > 0) setZoom(ZOOMS[i - 1]!);
    return zoom;
  };
  contents.on('did-finish-load', () => contents.setZoomFactor(zoom));
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
  handle('meyar:zoom', (_e, arg) =>
    arg === 'in' || arg === 'out' || arg === 'reset' ? step(arg) : zoom,
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
  return window;
}
