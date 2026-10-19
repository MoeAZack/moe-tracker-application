const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({
  bootstrapSession: (force = false) => ipcRenderer.invoke('desktop:bootstrap-session', force === true),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  createRecoveryBackup: () => ipcRenderer.invoke('desktop:create-recovery-backup'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  processMatch: () => ipcRenderer.invoke('desktop:process-match'),
  chooseVodFile: () => ipcRenderer.invoke('desktop:choose-vod-file'),
  discoverVodGames: (input) => ipcRenderer.invoke('desktop:discover-vod-games', input),
  analyzeVod: (input) => ipcRenderer.invoke('desktop:analyze-vod', input),
  releaseVodAnalysis: (cacheId) => ipcRenderer.invoke('desktop:release-vod-analysis', cacheId),
  cancelVodAnalysis: () => ipcRenderer.invoke('desktop:cancel-vod-analysis'),
  onVodAnalysisProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:vod-analysis-progress', listener);
    return () => ipcRenderer.removeListener('desktop:vod-analysis-progress', listener);
  },
  deleteReplay: (replayPath) => ipcRenderer.invoke('desktop:delete-replay', replayPath),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  pairDevice: (input) => ipcRenderer.invoke('desktop:pair-device', input),
  setSyncMode: (mode) => ipcRenderer.invoke('desktop:set-sync-mode', mode),
  setRetentionDays: (days) => ipcRenderer.invoke('desktop:set-retention-days', days),
  setStartWithWindows: (enabled) => ipcRenderer.invoke('desktop:set-start-with-windows', enabled),
  setCapturePaused: (paused) => ipcRenderer.invoke('desktop:set-capture-paused', paused),
  setCapturePreferences: (input) => ipcRenderer.invoke('desktop:set-capture-preferences', input),
  disconnectDevice: () => ipcRenderer.invoke('desktop:disconnect-device'),
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
