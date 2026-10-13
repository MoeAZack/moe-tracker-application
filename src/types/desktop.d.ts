export {};

type DesktopStatus = {
  mode: 'offline-first' | 'connected';
  deviceName: string;
  retentionDays: number;
  startWithWindows: boolean;
  cloudUrl: string;
  replayCount: number;
  pendingScoreboards: number;
  latestReplay: null | { name: string; path: string; size: number; modifiedAt: string };
  localService: 'online';
  folders: { replays: string; screenshots: string; exports: string; backups: string; logs: string; valorantReplays: string };
  collector: any;
  sync: { paired: boolean; server: string | null; pending: number; received: number };
};

declare global {
  interface Window {
    moeDesktop?: {
      bootstrapSession(): Promise<{ key: string; role: string; username: string }>;
      getStatus(): Promise<DesktopStatus>;
      processMatch(): Promise<{ state: string; message: string; items?: any[] }>;
      syncNow(): Promise<{ state: string; message: string }>;
      pairDevice(input: { server: string; code: string }): Promise<{ paired: boolean; server: string; device: any }>;
      setSyncMode(mode: 'offline-first' | 'connected'): Promise<{ mode: 'offline-first' | 'connected' }>;
      setRetentionDays(days: number): Promise<{ retentionDays: number }>;
      setStartWithWindows(enabled: boolean): Promise<{ startWithWindows: boolean }>;
      listScoreboards(): Promise<Array<{ id: string; name: string; size: number; modifiedAt: string; mediaType: string }>>;
      readScoreboard(id: string): Promise<{ id: string; name: string; mediaType: string; bytes: Uint8Array }>;
      completeScoreboard(id: string): Promise<{ completed: boolean }>;
      exportTeamPackage(input?: { password?: string }): Promise<{ exported: boolean; encrypted: boolean; path: string }>;
      previewTeamPackage(input?: { password?: string }): Promise<{ canceled: boolean; file?: string; preview?: any }>;
      importTeamPackage(): Promise<{ imported: boolean; message: string; result: any }>;
      openFolder(kind: 'replays' | 'screenshots' | 'exports' | 'backups' | 'logs'): Promise<{ opened: boolean; path: string }>;
      chooseReplayFolder(): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
