export function scan(options?: { allowUpload?: boolean; approvedHash?: string | null }): Promise<Array<Record<string, unknown>>>;
export function migrateConfig(raw?: Record<string, any>): Record<string, any>;
export const LOCAL_NORMALIZER_REVISION: string;
export const collectorInternals: {
  APP_DIR: string; EVIDENCE_DIR: string; DEFAULT_DEMO: string; normalizerRevision: string;
  inside(file: string, directory: string): boolean; canonicalFile(file: string): string;
  serverUrl(value: string): string;
  scoreboardApproval(file: string, folder: string, replaySha256: string, imageSha256: string, approvedAt?: string): Record<string, string>;
  uploadRequest(server: string, hash: string, token: string, file: string, size: number, deviceId: string): { endpoint: string; options: Record<string, unknown> };
  migrateConfig(raw?: Record<string, any>): Record<string, any>;
  validateNormalizedEvidence(raw: unknown, replaySha256: string): unknown;
  validateEvidenceEnvelope(raw: unknown, replaySha256: string, size: number, deviceId: string): unknown;
  readReusableEvidence(target: string, replaySha256: string, size: number, deviceId: string): Promise<any>;
  evidencePath(hash: string): string; pruneExpiredManagedReplays(state: any, config: any, nowMs?: number): Promise<string[]>;
  resumableOffset(session: any, size: number): Promise<any>; collectorUploadComplete(status: string): boolean;
};
