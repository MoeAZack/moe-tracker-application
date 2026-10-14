export {};

type DesktopStatus = {
  appVersion: string;
  mode: 'offline-first' | 'connected';
  deviceName: string;
  retentionDays: number;
  startWithWindows: boolean;
  cloudUrl: string;
  replayCount: number;
  pendingScoreboards: number;
  latestReplay: null | { name: string; path: string; size: number; modifiedAt: string };
  localService: 'online';
  update: { state: 'disabled' | 'current' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'; version: string | null; percent: number | null; message: string };
  folders: { replays: string; screenshots: string; exports: string; backups: string; logs: string; valorantReplays: string };
  collector: any;
  sync: { paired: boolean; server: string | null; pending: number; received: number };
};

declare global {
  const __APP_VERSION__: string;

  interface Window {
    moeDesktop?: {
      bootstrapSession(): Promise<{ key: string; role: string; username: string }>;
      getStatus(): Promise<DesktopStatus>;
      checkForUpdates(): Promise<DesktopStatus['update']>;
      downloadUpdate(): Promise<DesktopStatus['update']>;
      installUpdate(): Promise<{ installing: boolean }>;
      processMatch(): Promise<{ state: string; message: string; items?: any[] }>;
      syncNow(): Promise<{ state: string; message: string }>;
      pairDevice(input: { server: string; code: string }): Promise<{ paired: boolean; server: string; device: any }>;
      setSyncMode(mode: 'offline-first' | 'connected'): Promise<{ mode: 'offline-first' | 'connected' }>;
      setRetentionDays(days: number): Promise<{ retentionDays: number }>;
      setStartWithWindows(enabled: boolean): Promise<{ startWithWindows: boolean }>;
      listScoreboards(): Promise<Array<{ id: string; name: string; size: number; modifiedAt: string; mediaType: string; capture?: null | { captureId: string; template: string; requestedRounds: number } }>>;
      readScoreboard(id: string): Promise<{ id: string; name: string; mediaType: string; bytes: Uint8Array }>;
      readCaptureSession(id: string): Promise<{ id: string; captureId: string; template: string; requestedRounds: number; captures: Array<{ kind: 'scoreboard' | 'performance' | 'head-to-head' | 'round'; round?: number; name: string; mediaType: string; base64: string }> }>;
      completeScoreboard(id: string): Promise<{ completed: boolean }>;
      startScrimCapture(input: { roundCount: number; template: 'without-performance' | 'with-performance' }): Promise<{ started: boolean; message: string }>;
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
