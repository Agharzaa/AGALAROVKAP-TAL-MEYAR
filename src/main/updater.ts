/**
 * Automatic updates from the project's GitHub releases (electron-updater). The installed app
 * looks for a newer version when it starts and every four hours while it runs, downloads it in
 * the background and installs it when the app is closed — or at once, when the user presses
 * "İndi yenidən başlat". The database is never touched by the update itself: it stays in the
 * user's data folder, a startup copy is taken before any migration, and an older program refuses
 * a newer database.
 *
 * Off in development (not packaged), in the smoke test and with MEYAR_NO_UPDATE=1.
 */
import { app, type BrowserWindow } from 'electron';
import updater from 'electron-updater';

const { autoUpdater } = updater;
const EVERY = 4 * 60 * 60 * 1000;

export interface UpdateState {
  /** checking: looking; downloading: a newer version is coming; ready: installed on close. */
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  version: string;
  percent: number;
  message: string;
}

export function startUpdates(window: BrowserWindow): {
  current: () => UpdateState;
  install: () => void;
} {
  let now: UpdateState = { state: 'idle', version: '', percent: 0, message: '' };
  const set = (patch: Partial<UpdateState>) => {
    now = { ...now, ...patch };
    if (!window.isDestroyed()) window.webContents.send('meyar:update', now);
  };
  const off = !app.isPackaged || !!process.env.MEYAR_SMOKE || process.env.MEYAR_NO_UPDATE === '1';
  if (off) return { current: () => now, install: () => {} };

  // Releases are published as test pre-releases by CI (unsigned builds).
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: '' }));
  autoUpdater.on('update-not-available', () => set({ state: 'idle' }));
  autoUpdater.on('update-available', (info) =>
    set({ state: 'downloading', version: info.version, percent: 0 }),
  );
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) =>
    set({ state: 'ready', version: info.version, percent: 100 }),
  );
  // No network, GitHub unreachable…: the app works on; the next check tries again.
  autoUpdater.on('error', (error: Error) =>
    set({ state: now.state === 'ready' ? 'ready' : 'error', message: error.message }),
  );
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  const timer = setInterval(check, EVERY);
  app.on('will-quit', () => clearInterval(timer));
  return {
    current: () => now,
    // Closing goes through the window's own guard (unsaved documents ask first).
    install: () => {
      if (now.state === 'ready') autoUpdater.quitAndInstall(false, true);
    },
  };
}
