import { app, dialog, session } from 'electron';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedgerClient } from './ledger-client.js';
import { createMainWindow } from './window.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.resolve(here, '../../../web/index.html');
const preloadFile = path.join(here, '../preload/preload.cjs');
// User data lives outside the installation folder; uninstall and updates never touch it.
app.setPath('userData', process.env.MEYAR_DATA_DIR || path.join(app.getPath('appData'), 'Meyar'));
const dataDir = path.join(app.getPath('userData'), 'data');
const backupDir = path.join(app.getPath('userData'), 'backups');
// Ledger v3 (subkonto model) starts in its own file; the stage-A test database stays untouched.
const databaseFile = path.join(dataDir, 'meyar-v3.sqlite');
// Worker code must load from the real file system, not from inside app.asar.
const workerScript = path
  .join(here, 'ledger-worker.js')
  .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
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
  // Keep the 30 most recent startup copies; manual backups are never removed.
  const startups = (await readdir(backupDir)).filter((f) => /^startup-.*\.sqlite$/.test(f)).sort();
  for (const old of startups.slice(0, Math.max(0, startups.length - 30)))
    await rm(path.join(backupDir, old), { force: true });
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
      if (process.env.MEYAR_SMOKE) void smoke(window, process.env.MEYAR_SMOKE);
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

/**
 * Installer smoke test (MEYAR_SMOKE=<result.json>): drives the real preload → IPC → worker →
 * SQLite path inside the packaged app, saves a screenshot next to the result and quits.
 */
async function smoke(window: import('electron').BrowserWindow, out: string) {
  const { writeFile } = await import('node:fs/promises');
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const result: Record<string, unknown> = {};
  try {
    result.company = await js(
      `window.meyar.command({ type: 'company.create', key: 'smoke-0000001', name: 'Smoke MMC', taxId: '1000000009', vatPayer: true })`,
    );
    const id = (result.company as { value?: { id: string } }).value?.id;
    result.catalog = await js(
      `window.meyar.query({ type: 'catalog', companyId: ${JSON.stringify(id)} }).then(r => ({ ok: r.ok, accounts: r.value?.accounts.length }))`,
    );
    result.trial = await js(
      `window.meyar.query({ type: 'trialBalance', companyId: ${JSON.stringify(id)}, from: '2026-01-01', to: '2026-12-31' }).then(r => r.ok)`,
    );
    result.integrity = await js(
      `window.meyar.query({ type: 'integrity', companyId: ${JSON.stringify(id)} }).then(r => r.value?.ok)`,
    );
    window.webContents.reload();
    await new Promise((r) => setTimeout(r, 2500));
    await writeFile(
      out.replace(/\.json$/, '.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  } catch (error) {
    result.error = String(error);
  }
  await writeFile(out, JSON.stringify(result, null, 2));
  app.quit();
}
