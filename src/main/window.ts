import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
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
  window.once('ready-to-show', () => window.show());
  await window.loadFile(options.rendererFile);
  return window;
}
