export {};

type DesktopStatus = {
  mode: 'offline-first' | 'connected';
  deviceName: string;
  retentionDays: number;
  cloudUrl: string;
  replayCount: number;
  latestReplay: null | { name: string; path: string; size: number; modifiedAt: string };
  localService: 'online';
  folders: { replays: string; screenshots: string; exports: string; backups: string; valorantReplays: string };
  collector: any;
};

declare global {
  interface Window {
    moeDesktop?: {
      bootstrapSession(): Promise<{ key: string; role: string; username: string }>;
      getStatus(): Promise<DesktopStatus>;
      processMatch(): Promise<{ state: string; message: string; items?: any[] }>;
      syncNow(): Promise<{ state: string; message: string }>;
      exportTeamPackage(): Promise<{ exported: boolean; path: string }>;
      openFolder(kind: 'replays' | 'screenshots' | 'exports' | 'backups'): Promise<{ opened: boolean; path: string }>;
      chooseReplayFolder(): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
