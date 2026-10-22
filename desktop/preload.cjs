const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({
  bootstrapSession: (force = false) => ipcRenderer.invoke('desktop:bootstrap-session', force === true),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  takeRecoveredOcrLearning: () => ipcRenderer.invoke('desktop:take-recovered-ocr-learning'),
  confirmRecoveredOcrLearning: (ports) => ipcRenderer.invoke('desktop:confirm-recovered-ocr-learning', ports),
  createRecoveryBackup: () => ipcRenderer.invoke('desktop:create-recovery-backup'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  processMatch: () => ipcRenderer.invoke('desktop:process-match'),
  chooseVodFile: () => ipcRenderer.invoke('desktop:choose-vod-file'),
  discoverVodGames: (input) => ipcRenderer.invoke('desktop:discover-vod-games', input),
  readVodFrame: (input) => ipcRenderer.invoke('desktop:read-vod-frame', input),
  listVodJobs: () => ipcRenderer.invoke('desktop:list-vod-jobs'),
  listIngestionJobs: () => ipcRenderer.invoke('desktop:list-ingestion-jobs'),
  clearIngestionJobs: (ids) => ipcRenderer.invoke('desktop:clear-ingestion-jobs', ids),
  beginIngestionJob: (input) => ipcRenderer.invoke('desktop:begin-ingestion-job', input),
  updateIngestionJob: (input) => ipcRenderer.invoke('desktop:update-ingestion-job', input),
  cancelIngestionJob: (jobId) => ipcRenderer.invoke('desktop:cancel-ingestion-job', jobId),
  resumeVodJob: (jobId) => ipcRenderer.invoke('desktop:resume-vod-job', jobId),
  analyzeVod: (input) => ipcRenderer.invoke('desktop:analyze-vod', input),
  releaseVodAnalysis: (input) => ipcRenderer.invoke('desktop:release-vod-analysis', input),
  cancelVodAnalysis: () => ipcRenderer.invoke('desktop:cancel-vod-analysis'),
  createReviewClips: (input) => ipcRenderer.invoke('desktop:create-review-clips', input),
  openReviewClip: (fileName) => ipcRenderer.invoke('desktop:open-review-clip', fileName),
  onVodAnalysisProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:vod-analysis-progress', listener);
    return () => ipcRenderer.removeListener('desktop:vod-analysis-progress', listener);
  },
  onIngestionProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:ingestion-progress', listener);
    return () => ipcRenderer.removeListener('desktop:ingestion-progress', listener);
  },
  deleteReplay: (replayPath) => ipcRenderer.invoke('desktop:delete-replay', replayPath),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  pairDevice: (input) => ipcRenderer.invoke('desktop:pair-device', input),
  setSyncMode: (mode) => ipcRenderer.invoke('desktop:set-sync-mode', mode),
  setRetentionDays: (days) => ipcRenderer.invoke('desktop:set-retention-days', days),
  setStartWithWindows: (enabled) => ipcRenderer.invoke('desktop:set-start-with-windows', enabled),
  setVodPerformance: (input) => ipcRenderer.invoke('desktop:set-vod-performance', input),
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
