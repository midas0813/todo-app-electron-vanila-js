const { app, BrowserWindow, ipcMain, Notification, powerMonitor, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const iconPath = path.join(__dirname, 'build', 'icon.ico');

let activeWin;
try {
  activeWin = require('active-win');
} catch (err) {
  activeWin = null;
}

const dataFilePath = () => path.join(app.getPath('userData'), 'data.json');

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
  },
};

function loadData() {
  try {
    const raw = fs.readFileSync(dataFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultData,
      ...parsed,
      settings: { ...defaultData.settings, ...(parsed.settings || {}) },
    };
  } catch (err) {
    return { ...defaultData };
  }
}

function saveData(data) {
  fs.writeFileSync(dataFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}

// getSystemIdleState()'s 'locked' classification is not reliably reported on Windows;
// the lock/unlock events are the mechanism Electron actually guarantees for this.
let isSessionLocked = false;
powerMonitor.on('lock-screen', () => {
  isSessionLocked = true;
});
powerMonitor.on('unlock-screen', () => {
  isSessionLocked = false;
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

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Time Management');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Time Mgmt', click: showMainWindow },
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
  tray.on('click', showMainWindow);
}

app.whenReady().then(() => {
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

ipcMain.handle('notify:show', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
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
