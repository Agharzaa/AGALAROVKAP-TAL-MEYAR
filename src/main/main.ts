import { app, dialog, session } from 'electron';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedgerClient } from './ledger-client.js';
import { createMainWindow } from './window.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.resolve(here, '../../../web/index.html');
const preloadFile = path.join(here, '../preload/preload.cjs');
// User data lives outside the installation folder; uninstall and updates never touch it.
app.setPath('userData', path.join(app.getPath('appData'), 'Meyar'));
const dataDir = path.join(app.getPath('userData'), 'data');
const backupDir = path.join(app.getPath('userData'), 'backups');
// Ledger v3 (subkonto model) starts in its own file; the stage-A test database stays untouched.
const databaseFile = path.join(dataDir, 'meyar-v3.sqlite');
// Worker code must load from the real file system, not from inside app.asar.
const workerScript = path.join(here, 'ledger-worker.js').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
let ledger: LedgerClient | undefined;
let reader: LedgerClient | undefined;

/** Copy taken before migrations run, so a failed upgrade can always be undone. */
async function startupBackup() {
  try {
    await stat(databaseFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const source = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    await backup(source, path.join(backupDir, `startup-${stamp()}.sqlite`));
  } finally {
    source.close();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      await mkdir(dataDir, { recursive: true });
      await mkdir(backupDir, { recursive: true });
      await startupBackup();
      ledger = new LedgerClient(workerScript, databaseFile);
      await ledger.ready;
      reader = new LedgerClient(workerScript, databaseFile, true);
      await reader.ready;
      const window = await createMainWindow({
        ledger,
        reader,
        rendererFile,
        preloadFile,
        version: app.getVersion(),
        backup: async (owner) => {
          const result = await dialog.showSaveDialog(owner, {
            title: 'Ehtiyat nüsxəni saxla',
            defaultPath: path.join(backupDir, `meyar-${stamp()}.sqlite`),
            filters: [{ name: 'Meyar ehtiyat nüsxəsi', extensions: ['sqlite'] }],
          });
          if (result.canceled || !result.filePath) return null;
          if (path.resolve(result.filePath) === path.resolve(databaseFile))
            throw new Error('İşlək bazanın üzərinə yazmaq olmaz; başqa fayl adı seçin.');
          const done = await ledger!.call<string>({ op: 'backup', target: result.filePath });
          if (!done.ok) throw new Error(done.error.message);
          return result.filePath;
        },
      });
      app.on('second-instance', () => {
        if (window.isMinimized()) window.restore();
        window.focus();
      });
    })
    .catch((error: Error) => {
      dialog.showErrorBox('Meyar açılmadı', `${error.message}\n\nMəlumatlarınız dəyişdirilmədi.`);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  void ledger?.terminate();
  void reader?.terminate();
});
