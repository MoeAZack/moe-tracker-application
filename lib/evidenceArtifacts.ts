import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const EVIDENCE_ARTIFACT_SCHEMA = 1;
export const EVIDENCE_ARTIFACT_MIN_BYTES = 1024;

export type EvidenceArtifactRef = {
  __moeEvidenceArtifact: 1;
  sha256: string;
  bytes: number;
};

export type EvidenceArtifact = { sha256: string; bytes: number; json: string };

const isRef = (value: any): value is EvidenceArtifactRef => value?.__moeEvidenceArtifact === 1
  && typeof value?.sha256 === 'string' && Number.isSafeInteger(value?.bytes);

function clone<T>(value: T): T { return structuredClone(value); }

function artifact(value: any, artifacts: Map<string, EvidenceArtifact>) {
  if (value === undefined || value === null || isRef(value)) return value;
  const json = JSON.stringify(value); const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes < EVIDENCE_ARTIFACT_MIN_BYTES) return value;
  const sha256 = crypto.createHash('sha256').update(json).digest('hex');
  artifacts.set(sha256, { sha256, bytes, json });
  return { __moeEvidenceArtifact: 1, sha256, bytes } satisfies EvidenceArtifactRef;
}

function externalizeContainer(container: any, artifacts: Map<string, EvidenceArtifact>) {
  if (!container || typeof container !== 'object') return;
  for (const build of Object.values(container.analyticsBuilds || {}) as any[]) {
    if (build && typeof build === 'object' && build.intelligence !== undefined) build.intelligence = artifact(build.intelligence, artifacts);
  }
  for (const replay of Object.values(container.engineAdapters?.replay || {}) as any[]) {
    if (replay && typeof replay === 'object' && replay.draft !== undefined) replay.draft = artifact(replay.draft, artifacts);
  }
  for (const job of Object.values(container.replayIntake?.parserJobs || {}) as any[]) {
    if (job && typeof job === 'object' && job.result !== undefined) job.result = artifact(job.result, artifacts);
  }
  for (const round of container.rounds || []) {
    for (const key of ['screenshotEvidence', 'replayEvidence', 'vodEvidence', 'advantageEvidence']) {
      if (round?.[key] !== undefined) round[key] = artifact(round[key], artifacts);
    }
  }
}

const ARCHIVE_EVIDENCE_COLLECTIONS = [
  'matches', 'playerStats', 'rounds', 'vetos', 'stratRuns', 'vodReviews', 'vodSubmissions',
  'practiceBlocks', 'coachingSignals', 'coachingActions', 'evidenceFusionResolutions',
  'calibratedPlayerRatings', 'analyticsBuilds',
];

function externalizeArchive(archive: any, artifacts: Map<string, EvidenceArtifact>) {
  externalizeContainer(archive, artifacts);
  for (const key of ARCHIVE_EVIDENCE_COLLECTIONS) if (archive?.[key] !== undefined) archive[key] = artifact(archive[key], artifacts);
  if (archive?.engineAdapters !== undefined) archive.engineAdapters = artifact(archive.engineAdapters, artifacts);
}

/** Produce the small active index written by Storage v2 plus immutable,
 * content-addressed evidence payloads. The caller commits artifacts first and
 * activates the index last, so interrupted writes cannot create broken refs. */
export function externalizeEvidenceArtifacts(input: any) {
  const state = clone(input); const artifacts = new Map<string, EvidenceArtifact>();
  externalizeContainer(state, artifacts);
  for (const archive of state.seasonArchives || []) externalizeArchive(archive, artifacts);
  state._storage ||= {};
  state._storage.evidenceArtifacts = {
    schemaVersion: EVIDENCE_ARTIFACT_SCHEMA,
    count: artifacts.size,
    logicalBytes: [...artifacts.values()].reduce((sum, item) => sum + item.bytes, 0),
  };
  return { state, artifacts: [...artifacts.values()] };
}

export function evidenceStorageFootprint(input: any) {
  const planned = externalizeEvidenceArtifacts(input);
  const indexJson = JSON.stringify(planned.state);
  return {
    indexBytes: Buffer.byteLength(indexJson, 'utf8'),
    indexCharacters: indexJson.length,
    artifactCount: planned.artifacts.length,
    artifactLogicalBytes: planned.artifacts.reduce((sum, item) => sum + item.bytes, 0),
    artifactStoredBytes: planned.artifacts.reduce((sum, item) => sum + gzipSync(Buffer.from(item.json, 'utf8')).byteLength, 0),
  };
}

async function hydrateValue(value: any, load: (sha256: string) => Promise<string>) {
  if (!isRef(value)) return value;
  const json = await load(value.sha256);
  if (crypto.createHash('sha256').update(json).digest('hex') !== value.sha256) throw new Error(`Evidence artifact ${value.sha256} failed integrity validation.`);
  if (Buffer.byteLength(json, 'utf8') !== value.bytes) throw new Error(`Evidence artifact ${value.sha256} has the wrong length.`);
  return JSON.parse(json);
}

async function hydrateContainer(container: any, load: (sha256: string) => Promise<string>) {
  if (!container || typeof container !== 'object') return;
  for (const build of Object.values(container.analyticsBuilds || {}) as any[]) if (build && typeof build === 'object') build.intelligence = await hydrateValue(build.intelligence, load);
  for (const replay of Object.values(container.engineAdapters?.replay || {}) as any[]) if (replay && typeof replay === 'object') replay.draft = await hydrateValue(replay.draft, load);
  for (const job of Object.values(container.replayIntake?.parserJobs || {}) as any[]) if (job && typeof job === 'object') job.result = await hydrateValue(job.result, load);
  for (const round of container.rounds || []) for (const key of ['screenshotEvidence', 'replayEvidence', 'vodEvidence', 'advantageEvidence']) if (round?.[key] !== undefined) round[key] = await hydrateValue(round[key], load);
}

async function hydrateArchive(archive: any, load: (sha256: string) => Promise<string>) {
  for (const key of ARCHIVE_EVIDENCE_COLLECTIONS) if (archive?.[key] !== undefined) archive[key] = await hydrateValue(archive[key], load);
  if (archive?.engineAdapters !== undefined) archive.engineAdapters = await hydrateValue(archive.engineAdapters, load);
  await hydrateContainer(archive, load);
}

export async function hydrateEvidenceArtifacts(input: any, load: (sha256: string) => Promise<string>) {
  await hydrateContainer(input, load);
  for (const archive of input.seasonArchives || []) await hydrateArchive(archive, load);
  return input;
}

export function evidenceArtifactReferences(input: any) {
  const refs = new Set<string>();
  const visit = (value: any) => {
    if (isRef(value)) { refs.add(value.sha256); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(input); return refs;
}
