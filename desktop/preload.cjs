const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({
  bootstrapSession: () => ipcRenderer.invoke('desktop:bootstrap-session'),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  processMatch: () => ipcRenderer.invoke('desktop:process-match'),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  exportTeamPackage: () => ipcRenderer.invoke('desktop:export-team-package'),
  openFolder: (kind) => ipcRenderer.invoke('desktop:open-folder', kind),
  chooseReplayFolder: () => ipcRenderer.invoke('desktop:choose-replay-folder'),
}));
