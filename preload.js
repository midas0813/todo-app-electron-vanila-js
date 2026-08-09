const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  notify: (title, body) => ipcRenderer.invoke('notify:show', { title, body }),
  getIdleState: (thresholdSeconds) => ipcRenderer.invoke('system:idleState', thresholdSeconds),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
