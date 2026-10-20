import fs from 'fs/promises';
import path from 'path';
import { gunzipSync } from 'node:zlib';
import { hydrateEvidenceArtifacts } from './evidenceArtifacts';
import { ensureStorageSchema, migrateHydratedEvidence } from './storageSchema';

/**
 * Read-only snapshot of a local Storage v2 database for audit scripts. The
 * stored index alone carries artifact stubs, so audits that read it raw see
 * no round evidence; this hydrates from the artifact vault and fails closed
 * exactly like the server does. Nothing is written.
 */
export async function readOfflineSnapshot(dbPath: string, options: { artifactDir?: string; now?: string } = {}) {
  const raw = await fs.readFile(dbPath, 'utf8');
  const index = JSON.parse(raw);
  const artifactDir = path.resolve(options.artifactDir || process.env.EVIDENCE_ARTIFACT_DIR || `${dbPath}.evidence`);
  const state = structuredClone(index);
  const declared = Number(state?._storage?.schemaVersion || 1);
  ensureStorageSchema(state, options.now);
  await hydrateEvidenceArtifacts(state, async sha256 => {
    try { return gunzipSync(await fs.readFile(path.join(artifactDir, `${sha256}.json.gz`))).toString('utf8'); }
    catch (error: any) { throw new Error(`Evidence artifact ${sha256} could not be loaded: ${error?.message || error}`); }
  });
  migrateHydratedEvidence(state, declared, options.now);
  return { raw, index, state, artifactDir };
}
