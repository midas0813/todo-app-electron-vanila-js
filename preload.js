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
});
