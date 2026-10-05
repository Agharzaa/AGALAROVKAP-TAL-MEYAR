import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DomainError } from '../domain/errors.js';
import type { Outcome } from '../contracts/bridge.js';
import type { Ledger } from '../application/ledger.js';

export interface WindowOptions {
  ledger: Ledger;
  rendererFile: string;
  preloadFile: string;
  version: string;
  backup: (window: BrowserWindow) => Promise<string | null>;
}

/** Errors the user can act on are returned as data; anything else is logged and generalized. */
function outcome<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (error instanceof DomainError)
      return {
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          ...(error.field ? { field: error.field } : {}),
        },
      };
    console.error(error);
    return {
      ok: false,
      error: {
        message: 'Gözlənilməz xəta baş verdi. Məlumat dəyişdirilmədi; əməliyyatı yenidən yoxlayın.',
        code: 'internal',
      },
    };
  }
}

/**
 * The application has exactly one OS window. Modules and documents open as internal windows
 * inside it; any attempt to open another window or navigate away is refused.
 */
export async function createMainWindow(options: WindowOptions): Promise<BrowserWindow> {
  const appUrl = pathToFileURL(options.rendererFile).href;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Meyar',
    backgroundColor: '#eef1f3',
    autoHideMenuBar: true,
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
  handle('meyar:command', (_e, command) => {
    const result = outcome(() =>
      options.ledger.execute(command, { actor, correlationId: randomUUID() }),
    );
    const companyId = (command as { companyId?: unknown })?.companyId;
    if (result.ok && !result.value.replayed)
      contents.send('meyar:changed', typeof companyId === 'string' ? companyId : result.value.id);
    return result;
  });
  handle('meyar:query', (_e, query) => outcome(() => options.ledger.query(query)));
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
  window.once('ready-to-show', () => window.show());
  await window.loadFile(options.rendererFile);
  return window;
}
