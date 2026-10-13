const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({
  bootstrapSession: () => ipcRenderer.invoke('desktop:bootstrap-session'),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  processMatch: () => ipcRenderer.invoke('desktop:process-match'),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  pairDevice: (input) => ipcRenderer.invoke('desktop:pair-device', input),
  setSyncMode: (mode) => ipcRenderer.invoke('desktop:set-sync-mode', mode),
  setRetentionDays: (days) => ipcRenderer.invoke('desktop:set-retention-days', days),
  setStartWithWindows: (enabled) => ipcRenderer.invoke('desktop:set-start-with-windows', enabled),
  listScoreboards: () => ipcRenderer.invoke('desktop:list-scoreboards'),
  readScoreboard: (id) => ipcRenderer.invoke('desktop:read-scoreboard', id),
  completeScoreboard: (id) => ipcRenderer.invoke('desktop:complete-scoreboard', id),
  exportTeamPackage: (input) => ipcRenderer.invoke('desktop:export-team-package', input),
  previewTeamPackage: (input) => ipcRenderer.invoke('desktop:preview-team-package', input),
  importTeamPackage: () => ipcRenderer.invoke('desktop:import-team-package'),
  openFolder: (kind) => ipcRenderer.invoke('desktop:open-folder', kind),
  chooseReplayFolder: () => ipcRenderer.invoke('desktop:choose-replay-folder'),
}));
