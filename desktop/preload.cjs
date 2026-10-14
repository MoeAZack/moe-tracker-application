const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({
  bootstrapSession: () => ipcRenderer.invoke('desktop:bootstrap-session'),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  processMatch: () => ipcRenderer.invoke('desktop:process-match'),
  deleteReplay: (replayPath) => ipcRenderer.invoke('desktop:delete-replay', replayPath),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  pairDevice: (input) => ipcRenderer.invoke('desktop:pair-device', input),
  setSyncMode: (mode) => ipcRenderer.invoke('desktop:set-sync-mode', mode),
  setRetentionDays: (days) => ipcRenderer.invoke('desktop:set-retention-days', days),
  setStartWithWindows: (enabled) => ipcRenderer.invoke('desktop:set-start-with-windows', enabled),
  listScoreboards: () => ipcRenderer.invoke('desktop:list-scoreboards'),
  readScoreboard: (id) => ipcRenderer.invoke('desktop:read-scoreboard', id),
  readCaptureSession: (id) => ipcRenderer.invoke('desktop:read-capture-session', id),
  completeScoreboard: (id) => ipcRenderer.invoke('desktop:complete-scoreboard', id),
  startScrimCapture: (input) => ipcRenderer.invoke('desktop:start-scrim-capture', input),
  onCaptureReady: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:capture-ready', listener);
    return () => ipcRenderer.removeListener('desktop:capture-ready', listener);
  },
  getIntegrationSecretStatus: () => ipcRenderer.invoke('desktop:get-integration-secret-status'),
  setIntegrationSecret: (input) => ipcRenderer.invoke('desktop:set-integration-secret', input),
  exportTeamPackage: (input) => ipcRenderer.invoke('desktop:export-team-package', input),
  previewTeamPackage: (input) => ipcRenderer.invoke('desktop:preview-team-package', input),
  importTeamPackage: () => ipcRenderer.invoke('desktop:import-team-package'),
  openFolder: (kind) => ipcRenderer.invoke('desktop:open-folder', kind),
  chooseReplayFolder: () => ipcRenderer.invoke('desktop:choose-replay-folder'),
  reportDiagnostic: (input) => ipcRenderer.invoke('desktop:report-diagnostic', input),
  exportSupportBundle: () => ipcRenderer.invoke('desktop:export-support-bundle'),
  queueScreenshotSummary: (input) => ipcRenderer.invoke('desktop:queue-screenshot-summary', input),
}));
