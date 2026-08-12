const { app, BrowserWindow, ipcMain, Notification, powerMonitor, shell, Tray, Menu, nativeImage, screen, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Midas');

const iconPath = path.join(__dirname, 'build', 'icon.ico');

let activeWin;
try {
  activeWin = require('active-win');
} catch (err) {
  activeWin = null;
}

// Data normally lives in the OS-managed userData folder, but can be redirected
// to a user-chosen folder (e.g. a synced or removable drive) via Settings — so
// the same folder can be pointed at from multiple machines. The pointer to
// that choice has to live somewhere that's ALWAYS the fixed OS location
// (config.json), since the whole point of it is telling us where to look for
// everything else.
const configFilePath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFilePath(), 'utf-8'));
  } catch (err) {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
}

function resolveDataDir() {
  const config = readConfig();
  if (config.dataDir && fs.existsSync(config.dataDir)) return config.dataDir;
  return app.getPath('userData');
}

const dataFilePath = () => path.join(resolveDataDir(), 'data.json');
const dataBackupPath = () => path.join(resolveDataDir(), 'data.json.bak');

const defaultData = {
  tasks: [],
  dailyTasks: [],
  activityLog: [],
  appLog: [],
  bids: [],
  platforms: [],
  accounts: [],
  alarms: [],
  worldClocks: [],
  timerPresets: [],
  trackingEnabled: false,
  performanceHistory: {},
  settings: {
    trackingIntervalSec: 60,
    dailySummaryTime: null,
    performanceHistoryLastCheckedDate: null,
    dailySummaryNotifiedDate: null,
    additionalTaskWeight: 'middle',
    trayClickShowsTimePopup: true,
    sidebarPinned: true,
    alarmDurationMin: 5,
    alarmIntervalMin: 1,
    alarmRepeatCount: 3,
    alarmSound: 'alarm.wav',
    alarmVolume: 80,
    shortcuts: {
      trayPopup: 'CommandOrControl+Alt+T',
      toggleTracking: 'CommandOrControl+Alt+S',
      showWindow: 'CommandOrControl+Alt+M',
      dismissAlarm: 'CommandOrControl+Alt+D',
    },
  },
};

function mergeWithDefaults(parsed) {
  const settings = { ...defaultData.settings, ...(parsed.settings || {}) };
  // Shallow-merged like the rest of settings, `shortcuts` also needs its own
  // merge one level deeper — otherwise a saved settings.shortcuts object
  // (even one only missing a key added by a later update) would fully
  // replace the defaults instead of filling in around it.
  settings.shortcuts = { ...defaultData.settings.shortcuts, ...((parsed.settings && parsed.settings.shortcuts) || {}) };
  return {
    ...defaultData,
    ...parsed,
    settings,
  };
}

// Falls back to the one-generation-back backup if the main file is missing or
// corrupted (e.g. truncated by saveData() getting interrupted mid-write by an
// abrupt shutdown/restart) — only falls back to a genuinely empty state if
// neither the file nor its backup can be read. A corrupted main file is never
// silently discarded: it's renamed aside so the next save can't overwrite it
// for good and it stays around for recovery/inspection.
function loadData() {
  const mainPath = dataFilePath();
  try {
    return mergeWithDefaults(JSON.parse(fs.readFileSync(mainPath, 'utf-8')));
  } catch (err) {
    if (fs.existsSync(mainPath)) {
      try {
        const quarantinePath = path.join(path.dirname(mainPath), `data.json.corrupted-${Date.now()}`);
        fs.renameSync(mainPath, quarantinePath);
        console.error(`data.json was unreadable, moved aside to ${quarantinePath}:`, err);
      } catch (renameErr) {
        console.error('Failed to quarantine corrupted data.json:', renameErr);
      }
    }
  }

  try {
    const recovered = mergeWithDefaults(JSON.parse(fs.readFileSync(dataBackupPath(), 'utf-8')));
    console.error('Recovered data from data.json.bak after the main file was missing or corrupted.');
    return recovered;
  } catch (err) {
    return { ...defaultData };
  }
}

// Atomic write: write the new content to a temp file, then rename it over the
// real file. A rename is atomic on the same filesystem, so an interrupted
// write (crash, forced restart, power loss) can never leave data.json
// truncated — the old file stays intact and readable until the new one is
// fully written. Also refreshes a one-generation-back backup beforehand, so a
// bad save still leaves a recoverable prior copy.
function saveData(data) {
  const mainPath = dataFilePath();
  const tmpPath = `${mainPath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

  if (fs.existsSync(mainPath)) {
    try {
      fs.copyFileSync(mainPath, dataBackupPath());
    } catch (err) {
      console.error('Failed to refresh data.json.bak:', err);
    }
  }

  fs.renameSync(tmpPath, mainPath);
}

// The app was renamed from "time-management-app" / "Time Management" to
// "Midas" — Electron derives the per-user data folder from the app name, so
// without this, real accumulated data (bids, accounts, tasks) would appear to
// vanish on first launch under the new name. One-time, best-effort copy.
function migrateUserDataIfNeeded() {
  const newPath = dataFilePath();
  if (fs.existsSync(newPath)) return;

  const appDataDir = app.getPath('appData');
  const oldCandidates = ['time-management-app', 'Time Management'].map((name) => path.join(appDataDir, name, 'data.json'));

  for (const oldPath of oldCandidates) {
    if (!fs.existsSync(oldPath)) continue;
    try {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.copyFileSync(oldPath, newPath);
      console.log(`Migrated data from ${oldPath} to ${newPath}`);
    } catch (err) {
      console.error('Data migration failed:', err);
    }
    return;
  }
}

// getSystemIdleState()'s 'locked' classification is not reliably reported on Windows;
// the lock/unlock events are the mechanism Electron actually guarantees for this.
let isSessionLocked = false;
powerMonitor.on('lock-screen', () => {
  isSessionLocked = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system:lockStateChanged', true);
});
powerMonitor.on('unlock-screen', () => {
  isSessionLocked = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system:lockStateChanged', false);
});

let mainWindow;
let tray;
app.isQuitting = false;

function createWindow() {
  // Launched via the OS login item with our own --hidden flag (set in
  // setLoginItemEnabled below) — start backgrounded instead of popping the
  // window on every boot, consistent with this app's tray-first design.
  const startHidden = process.argv.includes('--hidden');

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    show: !startHidden,
    backgroundColor: '#14161c',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Closing the window hides it instead of quitting — tracking (and the tray
  // icon) keeps running in the background. Only the tray's "Quit" truly exits.
  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ---------- tray click flyout: today's Active/Idle/Locked/Untracked, small ---------- */

let trayPopup = null;

// Positions a small frameless window just outside the tray icon's bounds,
// flipping above/below/left/right depending on which screen edge the tray
// (and its taskbar) is actually on — Windows is usually bottom-right, but
// this shouldn't assume that.
function positionNearTray(win, trayBounds) {
  const [winW, winH] = win.getSize();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const work = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winW / 2);
  const y =
    trayBounds.y > work.y + work.height / 2
      ? Math.round(trayBounds.y - winH - 8) // taskbar at bottom: pop up above the icon
      : Math.round(trayBounds.y + trayBounds.height + 8); // taskbar at top: pop down below it

  x = Math.min(Math.max(x, work.x + 8), work.x + work.width - winW - 8);
  win.setPosition(x, y);
}

function createTrayPopup() {
  trayPopup = new BrowserWindow({
    width: 300,
    height: 260,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#1c1f27',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  trayPopup.loadFile(path.join(__dirname, 'renderer', 'tray-popup.html'));
  trayPopup.on('blur', () => trayPopup.hide());
}

function toggleTrayPopup() {
  if (!trayPopup || trayPopup.isDestroyed()) createTrayPopup();
  if (trayPopup.isVisible()) {
    trayPopup.hide();
    return;
  }
  positionNearTray(trayPopup, tray.getBounds());
  trayPopup.webContents.send('tray-popup:refresh');
  trayPopup.show();
  trayPopup.focus();
}

/* ---------- custom in-app toast, bottom-right, alongside the native OS notification ---------- */

let toastWindow = null;
let toastHideTimeout = null;

function ensureToastWindow() {
  if (toastWindow && !toastWindow.isDestroyed()) return toastWindow;
  toastWindow = new BrowserWindow({
    width: 320,
    height: 96,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  toastWindow.loadFile(path.join(__dirname, 'renderer', 'toast.html'));
  toastWindow.on('closed', () => {
    toastWindow = null;
  });
  return toastWindow;
}

function positionToast(win) {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const [w, h] = win.getSize();
  win.setPosition(work.x + work.width - w - 16, work.y + work.height - h - 16);
}

function showAppToast(title, body) {
  const win = ensureToastWindow();

  const send = () => {
    positionToast(win);
    win.webContents.send('toast:show', { title, body });
    win.showInactive();
    if (toastHideTimeout) clearTimeout(toastHideTimeout);
    toastHideTimeout = setTimeout(() => {
      if (win && !win.isDestroyed()) win.hide();
    }, 6000);
  };

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Midas');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Midas', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => {
    const showPopup = loadData().settings.trayClickShowsTimePopup !== false;
    if (showPopup) toggleTrayPopup();
    else showMainWindow();
  });
}

/* ---------- global keyboard shortcuts (work even when Midas isn't focused) ---------- */

// Two of these (toggling tracking, dismissing a ringing alarm) are actions the
// renderer owns the state for, so they're just forwarded as an event rather
// than handled here directly.
function registerShortcuts(shortcuts) {
  globalShortcut.unregisterAll();
  const merged = { ...defaultData.settings.shortcuts, ...(shortcuts || {}) };
  const actions = {
    trayPopup: () => toggleTrayPopup(),
    showWindow: () => showMainWindow(),
    toggleTracking: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('shortcut:toggleTracking'),
    dismissAlarm: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('shortcut:dismissAlarm'),
  };

  const failed = [];
  for (const [key, accelerator] of Object.entries(merged)) {
    if (!accelerator || !actions[key]) continue; // cleared/disabled by the user
    const ok = globalShortcut.register(accelerator, actions[key]);
    if (!ok) failed.push(key);
  }
  return failed;
}

app.whenReady().then(() => {
  migrateUserDataIfNeeded();
  createWindow();
  createTray();
  registerShortcuts(loadData().settings.shortcuts);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Intentionally no-op: closing to tray (see the window 'close' handler above)
  // means this only fires after a real quit, when there's nothing left to do.
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

ipcMain.handle('data:load', () => loadData());

ipcMain.handle('data:save', (event, data) => {
  saveData(data);
  return true;
});

ipcMain.handle('window:show', () => {
  showMainWindow();
  return true;
});

ipcMain.handle('notify:show', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
  showAppToast(title, body);
  return true;
});

ipcMain.handle('toast:dismiss', () => {
  if (toastHideTimeout) clearTimeout(toastHideTimeout);
  if (toastWindow && !toastWindow.isDestroyed()) toastWindow.hide();
  return true;
});

ipcMain.handle('system:idleState', (event, thresholdSeconds) => ({
  state: isSessionLocked ? 'locked' : powerMonitor.getSystemIdleState(thresholdSeconds || 60),
  idleSeconds: powerMonitor.getSystemIdleTime(),
}));

ipcMain.handle('system:activeWindow', async () => {
  if (!activeWin) return null;
  try {
    const w = await activeWin();
    if (!w || !w.owner) return null;
    return { appName: w.owner.name || null };
  } catch (err) {
    return null;
  }
});

ipcMain.handle('shell:openExternal', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

/* ---------- user-defined data folder ---------- */

ipcMain.handle('data:getFolder', () => resolveDataDir());

ipcMain.handle('data:openFolder', () => {
  shell.openPath(resolveDataDir());
  return true;
});

// Copies the existing data (if any) into the newly-chosen folder so switching
// is never destructive by default, then records the choice in config.json.
// The app still needs a restart afterward — every path derived from
// resolveDataDir() is only re-read at call time, but a lot of main-process
// state (the Tray menu, in-flight IPC handlers) was set up assuming the old
// location, so a clean relaunch is simpler and safer than trying to migrate
// everything live.
ipcMain.handle('data:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { changed: false };

  const newDir = result.filePaths[0];
  const oldDir = resolveDataDir();
  if (path.resolve(newDir) === path.resolve(oldDir)) return { changed: false };

  try {
    const oldFile = path.join(oldDir, 'data.json');
    const oldBackup = path.join(oldDir, 'data.json.bak');
    if (fs.existsSync(oldFile)) fs.copyFileSync(oldFile, path.join(newDir, 'data.json'));
    if (fs.existsSync(oldBackup)) fs.copyFileSync(oldBackup, path.join(newDir, 'data.json.bak'));
    writeConfig({ ...readConfig(), dataDir: newDir });
    return { changed: true, path: newDir };
  } catch (err) {
    return { changed: false, error: String(err.message || err) };
  }
});

ipcMain.handle('data:restartApp', () => {
  app.relaunch();
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle('data:saveTextFile', async (event, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
  if (result.canceled || !result.filePath) return { saved: false };
  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { saved: true, path: result.filePath };
  } catch (err) {
    return { saved: false, error: String(err.message || err) };
  }
});

ipcMain.handle('data:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `midas-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { exported: false };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(loadData(), null, 2), 'utf-8');
    return { exported: true, path: result.filePath };
  } catch (err) {
    return { exported: false, error: String(err.message || err) };
  }
});

// Goes through the same atomic saveData() as every other save, so an import
// that gets interrupted mid-write is exactly as crash-safe as a normal save —
// and the existing data.json.bak rollover means the pre-import data is still
// recoverable even without a dedicated "before import" backup step.
ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { imported: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('That file is not a valid Midas backup.');
    }
    saveData(mergeWithDefaults(parsed));
    return { imported: true };
  } catch (err) {
    return { imported: false, error: String(err.message || err) };
  }
});

/* ---------- launch on startup ---------- */

ipcMain.handle('app:getLaunchOnStartup', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('app:setLaunchOnStartup', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    openAsHidden: true, // honored on macOS
    args: enabled ? ['--hidden'] : [], // used on Windows/Linux — see createWindow()
  });
  return app.getLoginItemSettings().openAtLogin;
});

/* ---------- global shortcuts ---------- */

// Returns the accelerator keys that failed to register (e.g. already claimed
// by another app) so the renderer can surface that instead of pretending it
// worked.
ipcMain.handle('shortcuts:update', (event, shortcuts) => registerShortcuts(shortcuts));
