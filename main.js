const { app, BrowserWindow, ipcMain, Notification, powerMonitor, shell } = require('electron');
const path = require('path');
const fs = require('fs');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#14161c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
