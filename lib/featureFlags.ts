export const MOE_02_FEATURE_FLAGS = {
  canonicalDataSpine: { stage: 1, description: 'Canonical entities, provenance and identity boundaries.' },
  dynamicResourceCatalog: { stage: 2, description: 'Runtime map, agent and weapon catalogs.' },
  unifiedIngestion: { stage: 3, description: 'One resumable ingestion job model for replay, screenshot and VOD.' },
  evidenceFusionV2: { stage: 4, description: 'Field-level evidence fusion and conflict resolution.' },
  unifiedReviewWorkspace: { stage: 5, description: 'One review workflow across every evidence source.' },
  metricsExplorer: { stage: 6, description: 'Unified player, agent, map and economy analysis.' },
  developmentLoopV2: { stage: 7, description: 'Goal, finding and follow-up measurement loop.' },
  contextualRoundIntelligence: { stage: 8, description: 'Round context, advantage and utility sequencing.' },
  spatialPlaybookV2: { stage: 9, description: 'Replay-backed paths, heatmaps and playbook overlays.' },
  teamOperationsV2: { stage: 10, description: 'Scheduling, attendance and team operations automation.' },
  releaseCandidate02: { stage: 11, description: 'Moe Tracker 0.2 release-candidate surfaces.' },
} as const;

export type Moe02FeatureFlag = keyof typeof MOE_02_FEATURE_FLAGS;
export type Moe02FeatureFlags = Record<Moe02FeatureFlag, boolean>;

export const DEFAULT_MOE_02_FEATURE_FLAGS = Object.freeze(
  Object.fromEntries(Object.keys(MOE_02_FEATURE_FLAGS).map(key => [key, false])) as Moe02FeatureFlags,
);

export function resolveMoe02FeatureFlags(input: unknown = {}): Moe02FeatureFlags {
  const supplied = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(MOE_02_FEATURE_FLAGS).map(key => [key, supplied[key] === true])) as Moe02FeatureFlags;
}

export function moe02FeatureEnabled(flag: Moe02FeatureFlag, input?: unknown) {
  return resolveMoe02FeatureFlags(input)[flag];
}
