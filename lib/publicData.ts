import { buildAcceptedMatchAggregatePlan, buildCanonicalAnalyticsExport, PLAYER_SCREENSHOT_BUILDER } from './aggregateVersioning';
import { buildCanonicalDataSpine, validateCanonicalDataSpine } from './canonicalDataSpine';
import { moe02FeatureEnabled } from './featureFlags';
import { isDuplicateQuarantined } from './matchIntegrity';

const PRIVATE_TOP_LEVEL_KEYS = new Set(['authKeys', 'allowedUsers', 'secretValues', '_storage', 'authenticatedViewer', 'tryoutDecisionNotes', 'identityCorrectionBatches']);
const PRIVATE_SETTING_KEYS = new Set(['discordWebhook', 'gridApiKey', 'henrikApiKey', 'praccCalendarUrl', 'praccCalendarLastAttemptAt', 'praccCalendarLastSyncedAt', 'praccCalendarLastError', 'deletedCoachingSignalFingerprints']);

/** Build the tracker payload that is safe to send to the authenticated role. */
export function toPublicTrackerData(db: Record<string, any>, role: 'coach' | 'player' = 'coach', authenticatedPlayerId?: string | null) {
  const publicData: Record<string, any> = {};
  for (const [key, value] of Object.entries(db)) {
    if (!PRIVATE_TOP_LEVEL_KEYS.has(key)) publicData[key] = value;
  }
  const settings = { ...(publicData.settings || {}) };
  if (Array.isArray(publicData.rosterPlayers) && Array.isArray(publicData.coreMemberships)) {
    const activeCoreIds = new Set(publicData.coreMemberships.filter((membership: any) => !membership.endedAt).map((membership: any) => membership.playerId));
    settings.players = publicData.rosterPlayers.filter((player: any) => !player.retiredAt && activeCoreIds.has(player.id)).map((player: any) => player.displayName);
    settings.inactivePlayers = [];
  }
  // Replay intake contains device credentials, ownership links, raw parser evidence,
  // and mutable review overlays. Engine adapters contain private rating inputs and
  // replay observations. Both have dedicated role-aware endpoints and must never
  // hitchhike in the broad tracker payload, including for coaches.
  if (Array.isArray(publicData.matches) && Array.isArray(publicData.rounds)) {
    const plans = new Map<string, ReturnType<typeof buildAcceptedMatchAggregatePlan>>(publicData.matches.map((match: any) => [match.id, buildAcceptedMatchAggregatePlan(publicData, match.id)]));
    publicData.matches = publicData.matches.map((match: any) => {
      const plan = plans.get(match.id)!;
      if (plan.build.status === 'recomputed' && plan.match) return plan.match;
      const { roundAnalytics: _quarantinedAggregate, ...sourceOnly } = match;
      return sourceOnly;
    });
    if (Array.isArray(publicData.playerStats)) publicData.playerStats = publicData.playerStats.map((stat: any) => {
      const plan = plans.get(stat.matchId);
      const planned = plan?.playerStats.find(item => item.id === stat.id);
      const metric = planned?.screenshotMetrics;
      if (plan?.build.status === 'recomputed' && metric?.calculationVersion === PLAYER_SCREENSHOT_BUILDER
        && metric.sourceHash === plan.build.sourceHash) return planned;
      const { screenshotMetrics: _quarantinedAggregate, ...sourceOnly } = stat;
      return sourceOnly;
    });
  }
  if (role === 'coach' && db.workspace && Array.isArray(db.matches)) {
    publicData.canonicalAnalytics = db.matches.map((match: any) => {
      const { canonicalJson: _canonicalJson, ...exported } = buildCanonicalAnalyticsExport(db, match.id);
      return exported;
    });
  }
  if (role === 'coach' && moe02FeatureEnabled('canonicalDataSpine', db.settings?.featureFlags)) {
    const spine = buildCanonicalDataSpine(db); const validation = validateCanonicalDataSpine(spine);
    if (!validation.ok) throw Object.assign(new Error('Canonical data spine contains broken references.'), { status: 500, issues: validation.issues });
    publicData.canonicalDataSpine = spine;
  } else delete publicData.canonicalDataSpine;
  if (role === 'coach') publicData.tryoutDecisionNotes = structuredClone(db.tryoutDecisionNotes || []);
  if (role === 'coach') publicData.identityCorrectionBatches = structuredClone(db.identityCorrectionBatches || []);
  delete publicData.replayIntake;
  delete publicData.engineAdapters;
  if (Array.isArray(publicData.seasonArchives)) publicData.seasonArchives = publicData.seasonArchives.map((archive: any) => {
    const { accessIdentities: _privateAccessIdentities, engineAdapters: _privateEngineAdapters, replayIntake: _privateReplayIntake, ...safeArchive } = archive || {};
    return safeArchive;
  });
  for (const key of PRIVATE_SETTING_KEYS) delete settings[key];
  if (role === 'player') {
    delete settings.riotIds;
    // Full archive bodies contain private identifiers and historical coach/VOD
    // material. Players do not need archive data for any read-only view.
    publicData.seasonArchives = [];
    publicData.vodReviews = [];
    publicData.vodSubmissions = (publicData.vodSubmissions || []).filter((submission: any) => authenticatedPlayerId && submission.submittedByPlayerId === authenticatedPlayerId);
    publicData.matches = (publicData.matches || []).map(({ notes: _notes, vod: _vod, corrections: _corrections, ...match }: any) => match);
    publicData.schedule = (publicData.schedule || []).map(({ attendanceAudit: _attendanceAudit, ...event }: any) => event);
    publicData.playerStats = (publicData.playerStats || []).map(({ notes: _notes, corrections: _corrections, ...stat }: any) => stat);
    publicData.rounds = (publicData.rounds || []).map(({ notes: _notes, isThrow: _isThrow, thrownBy: _thrownBy, throwReason: _throwReason, iglPlayer: _iglPlayer, iglRole: _iglRole, midRoundIglChange: _midRoundIglChange, strategies: _strategies, corrections: _corrections, ...round }: any) => round);
    publicData.practiceBlocks = (publicData.practiceBlocks || []).map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => block);
    publicData.coachingSignals = [];
    publicData.evidenceFusionResolutions = [];
    publicData.dashboardViews = [];
    publicData.coachingActions = (publicData.coachingActions || []).filter((action: any) => action.visibility === 'team' && (!authenticatedPlayerId || !action.ownerIds?.length || action.ownerIds.includes(authenticatedPlayerId)));
  }
  publicData.settings = settings;
  publicData.secrets = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    HENRIK_API_KEY: !!process.env.HENRIK_API_KEY,
    GRID_API_KEY: !!process.env.GRID_API_KEY,
    DISCORD_WEBHOOK_URL: !!process.env.DISCORD_WEBHOOK_URL
  };
  if (authenticatedPlayerId !== undefined) {
    publicData.authenticatedViewer = {
      playerId: role === 'player' && typeof authenticatedPlayerId === 'string' && authenticatedPlayerId.trim()
        ? authenticatedPlayerId.trim()
        : null,
    };
  }
  return publicData;
}

const WEBSITE_MATCH_FIELDS = ['id', 'date', 'type', 'opponent', 'opponentCategory', 'map', 'attW', 'attL', 'defW', 'defL', 'ourScore', 'theirScore', 'pistolAtt', 'pistolDef', 'ecoAtt', 'ecoDef', 'bonusAtt', 'bonusDef', 'rosterContext', 'roundAnalytics'] as const;
const WEBSITE_STAT_FIELDS = ['id', 'matchId', 'player', 'playerId', 'displayNameSnapshot', 'appearanceType', 'agent', 'roleSnapshot', 'kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'headshots', 'headshotEligibleKills', 'fk', 'fd', 'plants', 'defuses', 'cl', 'clAtt', 'mk3', 'mk4', 'mk5', 'dTraded', 'kTraded', 'rating', 'screenshotMetrics'] as const;

function selectFields(record: any, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, structuredClone(record[key])]));
}

/** Minimal authenticated website projection. Detailed evidence remains desktop-only. */
export function toWebsiteTrackerData(db: Record<string, any>, role: 'coach' | 'player' = 'coach', authenticatedPlayerId?: string | null) {
  const safe = toPublicTrackerData(db, role, authenticatedPlayerId);
  // A suspected re-capture waits on a coach decision; the website counts each game once.
  const quarantinedMatchIds = new Set((safe.matches || []).filter(isDuplicateQuarantined).map((match: any) => match.id));
  const settings = { ...(safe.settings || {}) };
  delete settings.riotIds;
  delete settings.vlr;
  delete settings.ai;
  settings.calendars = Array.isArray(settings.calendars)
    ? settings.calendars.map(({ gcalId: _privateCalendarId, ...calendar }: any) => calendar)
    : [];
  return {
    ...(safe.authenticatedViewer ? { authenticatedViewer: structuredClone(safe.authenticatedViewer) } : {}),
    settings,
    rosterPlayers: structuredClone(safe.rosterPlayers || []),
    coreMemberships: structuredClone(safe.coreMemberships || []),
    tryoutBatches: structuredClone(safe.tryoutBatches || []),
    practiceBlocks: (safe.practiceBlocks || []).map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => structuredClone(block)),
    coachingSignals: role === 'coach' ? structuredClone(safe.coachingSignals || []) : [],
    coachingActions: structuredClone(safe.coachingActions || []),
    dashboardViews: role === 'coach' ? structuredClone(safe.dashboardViews || []) : [],
    schedule: (safe.schedule || []).map((item: any) => selectFields(item, ['id', 'date', 'kind', 'primary', 'secondary', 'notes', 'coachNotes', 'attendance', 'calendarKey', 'startTime', 'allDay', 'durationMinutes', 'repeatSeriesId', 'repeatIndex', 'repeatCount', 'attendanceEnabled', 'requiredPlayerIds', 'attendanceCheckIns', 'source', 'sourceEventId', 'practiceBlockId', 'linkedGoalIds', 'progressLinkedAt', 'linkedReviewEventId'])),
    attendanceCredits: structuredClone(safe.attendanceCredits || []),
    goals: (safe.goals || []).map((item: any) => selectFields(item, ['id', 'date', 'goal', 'notes', 'status', 'owner', 'ownerPlayerId', 'matchId', 'roundId', 'evidenceClipId', 'sourceSignalId', 'coachingActionId', 'dueBlockId'])),
    matches: (safe.matches || []).filter((item: any) => !quarantinedMatchIds.has(item.id)).map((item: any) => ({
      ...selectFields(item, WEBSITE_MATCH_FIELDS),
      comparisonEvidence: { accepted: item.sourceMetadata?.method === 'screenshot' ? item.reviewConfirmation?.alliedSideConfirmed === true : !!item.sourceMetadata && item.sourceMetadata.method !== 'unknown' },
    })),
    playerStats: (safe.playerStats || []).filter((item: any) => !quarantinedMatchIds.has(item.matchId)).map((item: any) => ({
      ...selectFields(item, WEBSITE_STAT_FIELDS),
      comparisonEvidence: { openingAccepted: !!item.sourceMetadata && item.sourceMetadata.method !== 'unknown' },
    })),
    soloq: (safe.soloq || []).map((item: any) => selectFields(item, ['id', 'date', 'player', 'wins', 'losses', 'rank', 'rr', 'source'])),
    // Keep the TrackerData shape stable while proving that detailed desktop-only
    // collections are never transferred to the browser summary portal.
    rounds: [], vetos: [], strats: [], stratRuns: [], seasonArchives: [], vodReviews: [], lineups: [],
    secrets: {}, serverTime: new Date().toISOString(),
  };
}

/** Exact payload used by the authenticated shareable backup route. */
export function buildShareableBackupPayload(db: Record<string, any>) {
  const payload = toPublicTrackerData(db, 'coach');
  delete payload.tryoutDecisionNotes;
  payload.practiceBlocks = (payload.practiceBlocks || []).map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => block);
  payload.seasonArchives = (payload.seasonArchives || []).map(({ tryoutDecisionNotes: _privateNotes, ...archive }: any) => ({
    ...archive,
    practiceBlocks: (archive.practiceBlocks || []).map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => block),
  }));
  return payload;
}

/** Remove credential fields from imported legacy backups before storage. */
export function stripLegacySecrets<T extends Record<string, any>>(input: T): T {
  const clean: Record<string, any> = { ...input };
  delete clean.authKeys;
  delete clean.secretValues;
  if (clean.settings) {
    clean.settings = { ...clean.settings };
    for (const key of PRIVATE_SETTING_KEYS) delete clean.settings[key];
  }
  return clean as T;
}
