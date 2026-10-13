export {};

type DesktopStatus = {
  mode: 'offline-first' | 'connected';
  deviceName: string;
  retentionDays: number;
  cloudUrl: string;
  replayCount: number;
  pendingScoreboards: number;
  latestReplay: null | { name: string; path: string; size: number; modifiedAt: string };
  localService: 'online';
  folders: { replays: string; screenshots: string; exports: string; backups: string; valorantReplays: string };
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
      listScoreboards(): Promise<Array<{ id: string; name: string; size: number; modifiedAt: string; mediaType: string }>>;
      readScoreboard(id: string): Promise<{ id: string; name: string; mediaType: string; bytes: Uint8Array }>;
      completeScoreboard(id: string): Promise<{ completed: boolean }>;
      exportTeamPackage(): Promise<{ exported: boolean; path: string }>;
      previewTeamPackage(): Promise<{ canceled: boolean; file?: string; preview?: any }>;
      importTeamPackage(): Promise<{ imported: boolean; message: string; result: any }>;
      openFolder(kind: 'replays' | 'screenshots' | 'exports' | 'backups'): Promise<{ opened: boolean; path: string }>;
      chooseReplayFolder(): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
