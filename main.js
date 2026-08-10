const { app, BrowserWindow, ipcMain, Notification, powerMonitor, shell, Tray, Menu, nativeImage, screen } = require('electron');
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

const dataFilePath = () => path.join(app.getPath('userData'), 'data.json');
const dataBackupPath = () => path.join(app.getPath('userData'), 'data.json.bak');

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
  settings: {
    trackingIntervalSec: 60,
    dailySummaryTime: null,
    dailySummaryNotifiedDate: null,
    additionalTaskWeight: 'middle',
    trayClickShowsTimePopup: true,
    sidebarPinned: true,
    alarmDurationMin: 5,
    alarmIntervalMin: 1,
    alarmRepeatCount: 3,
    alarmSound: 'alarm.wav',
    alarmVolume: 80,
  },
};

function mergeWithDefaults(parsed) {
  return {
    ...defaultData,
    ...parsed,
    settings: { ...defaultData.settings, ...(parsed.settings || {}) },
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
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 780,
    minHeight: 560,
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

app.whenReady().then(() => {
  migrateUserDataIfNeeded();
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
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
