export {};

type DesktopStatus = {
  appVersion: string;
  deviceId: string;
  mode: 'offline-first' | 'connected';
  deviceName: string;
  retentionDays: number;
  startWithWindows: boolean;
  role: string;
  teamName: string | null;
  capture: { state: 'waiting-for-valorant' | 'match-detected' | 'capture-ready' | 'capturing' | 'review-required' | 'uploading' | 'synchronized' | 'paused' | 'error'; paused: boolean; preferences: { profile: 'fullscreen' | 'fullscreen-windowed' | 'windowed'; display: string; notification: 'open-review' | 'notify-only' | 'silent'; offlineQueue: boolean }; safety: 'post-match-only'; lastError: string | null };
  cloudUrl: string;
  replayCount: number;
  replays: Array<{ name: string; path: string; size: number; modifiedAt: string }>;
  pendingScoreboards: number;
  recovery: { lastBackupAt: string | null; verifiedRecent: boolean };
  latestReplay: null | { name: string; path: string; size: number; modifiedAt: string };
  localService: 'online' | 'offline';
  update: { state: 'disabled' | 'current' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'; version: string | null; percent: number | null; message: string };
  folders: { replays: string; screenshots: string; exports: string; backups: string; logs: string; valorantReplays: string };
  collector: any;
  sync: { paired: boolean; server: string | null; pending: number; received: number };
};

declare global {
  const __APP_VERSION__: string;

  interface Window {
    moeDesktop?: {
      bootstrapSession(force?: boolean): Promise<{ key: string; role: string; username: string; expiresAt?: string }>;
      getStatus(): Promise<DesktopStatus>;
      createRecoveryBackup(): Promise<{ backupId?: string; createdAt?: string; message: string }>;
      checkForUpdates(): Promise<DesktopStatus['update']>;
      downloadUpdate(): Promise<DesktopStatus['update']>;
      installUpdate(): Promise<{ installing: boolean }>;
      processMatch(): Promise<{ state: string; message: string; items?: any[] }>;
      chooseVodFile(): Promise<{ canceled: boolean; path?: string; name?: string }>;
      discoverVodGames(input: { vodUrl?: string; localPath?: string; expectedGames?: number; mapNames?: string[] }): Promise<{ cacheId: string; uploadDate: string | null; uploader: string | null; vodUrl: string | null; videoId: string | null; durationMs: number; width: number; height: number; games: Array<{ timestampMs: number; score: number; agentSelectScore: number; mediaType: string; base64: string }>; boundaries: Array<{ timestampMs: number; score: number; agentSelectScore: number; map: string | null; mediaType: string; base64: string }> }>;
      analyzeVod(input: { vodUrl?: string; localPath?: string; cacheId?: string; startMs?: number; endMs?: number | null; povPlayerName?: string | null; observerMode?: boolean; players: Array<{ name: string; team: 'ours' | 'theirs'; expectedKills?: number | null; expectedDeaths?: number | null }> }): Promise<any>;
      releaseVodAnalysis(cacheId: string): Promise<{ released: boolean }>;
      cancelVodAnalysis(): Promise<{ cancelled: boolean }>;
      onVodAnalysisProgress(callback: (progress: { stage: string; percent: number | null; message: string }) => void): () => void;
      deleteReplay(replayPath: string): Promise<{ deleted: boolean; message: string }>;
      syncNow(): Promise<{ state: string; message: string }>;
      pairDevice(input: { server: string; code: string }): Promise<{ paired: boolean; server: string; device: any }>;
      setSyncMode(mode: 'offline-first' | 'connected'): Promise<{ mode: 'offline-first' | 'connected' }>;
      setRetentionDays(days: number): Promise<{ retentionDays: number }>;
      setStartWithWindows(enabled: boolean): Promise<{ startWithWindows: boolean }>;
      setCapturePaused(paused: boolean): Promise<{ paused: boolean }>;
      setCapturePreferences(input: { profile: 'fullscreen' | 'fullscreen-windowed' | 'windowed'; display: string; notification: 'open-review' | 'notify-only' | 'silent'; offlineQueue: boolean }): Promise<DesktopStatus['capture']['preferences']>;
      disconnectDevice(): Promise<{ disconnected: boolean }>;
      listScoreboards(): Promise<Array<{ id: string; name: string; size: number; modifiedAt: string; mediaType: string; capture?: null | { captureId: string; template: string; requestedRounds: number } }>>;
      readScoreboard(id: string): Promise<{ id: string; imageSha256: string; name: string; mediaType: string; bytes: Uint8Array }>;
      readCaptureSession(id: string): Promise<{ id: string; captureId: string; template: string; requestedRounds: number; captures: Array<{ kind: 'scoreboard' | 'performance' | 'head-to-head' | 'round'; round?: number; name: string; mediaType: string; base64: string }> }>;
      completeScoreboard(id: string): Promise<{ completed: boolean }>;
      startScrimCapture(input: { roundCount?: number | null }): Promise<{ started: boolean; message: string }>;
      onCaptureReady(callback: (capture: { id: string; captureId: string }) => void): () => void;
      getIntegrationSecretStatus(): Promise<{ encryptionAvailable: boolean; configured: Record<'GEMINI_API_KEY' | 'GRID_API_KEY' | 'DISCORD_WEBHOOK_URL', boolean>; scope: 'local-device' }>;
      setIntegrationSecret(input: { key: 'GEMINI_API_KEY' | 'GRID_API_KEY' | 'DISCORD_WEBHOOK_URL'; value: string }): Promise<{ configured: boolean }>;
      exportTeamPackage(input?: { password?: string }): Promise<{ exported: boolean; encrypted: boolean; path: string }>;
      previewTeamPackage(input?: { password?: string }): Promise<{ canceled: boolean; file?: string; preview?: any }>;
      importTeamPackage(): Promise<{ imported: boolean; message: string; result: any }>;
      openFolder(kind: 'replays' | 'screenshots' | 'exports' | 'backups' | 'logs'): Promise<{ opened: boolean; path: string }>;
      reportDiagnostic(input: { action: string; message: string }): Promise<{ code: string }>;
      exportSupportBundle(): Promise<{ path: string; fileCount: number; includedCapture: boolean; message: string }>;
      queueScreenshotSummary(input: any): Promise<{ queued: boolean; id: string }>;
      chooseReplayFolder(): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
