const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  notify: (title, body) => ipcRenderer.invoke('notify:show', { title, body }),
  getIdleState: (thresholdSeconds) => ipcRenderer.invoke('system:idleState', thresholdSeconds),
  getActiveWindow: () => ipcRenderer.invoke('system:activeWindow'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showWindow: () => ipcRenderer.invoke('window:show'),
  onToast: (callback) => ipcRenderer.on('toast:show', (event, data) => callback(data)),
  dismissToast: () => ipcRenderer.invoke('toast:dismiss'),
  onTrayPopupRefresh: (callback) => ipcRenderer.on('tray-popup:refresh', () => callback()),
  onLockStateChanged: (callback) => ipcRenderer.on('system:lockStateChanged', (event, locked) => callback(locked)),

  getDataFolder: () => ipcRenderer.invoke('data:getFolder'),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  pickDataFolder: () => ipcRenderer.invoke('data:pickFolder'),
  restartApp: () => ipcRenderer.invoke('data:restartApp'),
  saveTextFile: (defaultName, content) => ipcRenderer.invoke('data:saveTextFile', { defaultName, content }),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),

  getLaunchOnStartup: () => ipcRenderer.invoke('app:getLaunchOnStartup'),
  setLaunchOnStartup: (enabled) => ipcRenderer.invoke('app:setLaunchOnStartup', enabled),

  updateShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:update', shortcuts),
  onShortcutToggleTracking: (callback) => ipcRenderer.on('shortcut:toggleTracking', () => callback()),
  onShortcutDismissAlarm: (callback) => ipcRenderer.on('shortcut:dismissAlarm', () => callback()),
});
