const PRIVATE_TOP_LEVEL_KEYS = new Set(['authKeys', 'allowedUsers', 'secretValues', '_storage']);
const PRIVATE_SETTING_KEYS = new Set(['discordWebhook', 'gridApiKey', 'henrikApiKey']);

/** Build the tracker payload that is safe to send to the authenticated role. */
export function toPublicTrackerData(db: Record<string, any>, role: 'coach' | 'player' = 'coach') {
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
    publicData.matches = (publicData.matches || []).map(({ notes: _notes, vod: _vod, corrections: _corrections, ...match }: any) => match);
    publicData.playerStats = (publicData.playerStats || []).map(({ notes: _notes, corrections: _corrections, ...stat }: any) => stat);
    publicData.rounds = (publicData.rounds || []).map(({ notes: _notes, isThrow: _isThrow, thrownBy: _thrownBy, throwReason: _throwReason, iglPlayer: _iglPlayer, iglRole: _iglRole, midRoundIglChange: _midRoundIglChange, strategies: _strategies, corrections: _corrections, ...round }: any) => round);
  }
  publicData.settings = settings;
  publicData.secrets = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    HENRIK_API_KEY: !!process.env.HENRIK_API_KEY,
    GRID_API_KEY: !!process.env.GRID_API_KEY,
    DISCORD_WEBHOOK_URL: !!process.env.DISCORD_WEBHOOK_URL
  };
  return publicData;
}

const WEBSITE_MATCH_FIELDS = ['id', 'date', 'type', 'opponent', 'map', 'attW', 'attL', 'defW', 'defL', 'ourScore', 'theirScore', 'pistolAtt', 'pistolDef', 'ecoAtt', 'ecoDef', 'bonusAtt', 'bonusDef', 'rosterContext'] as const;
const WEBSITE_STAT_FIELDS = ['id', 'matchId', 'player', 'playerId', 'displayNameSnapshot', 'appearanceType', 'agent', 'kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'headshots', 'headshotEligibleKills', 'fk', 'fd', 'plants', 'defuses', 'cl', 'clAtt', 'mk3', 'mk4', 'mk5', 'dTraded', 'kTraded', 'rating'] as const;

function selectFields(record: any, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, structuredClone(record[key])]));
}

/** Minimal authenticated website projection. Detailed evidence remains desktop-only. */
export function toWebsiteTrackerData(db: Record<string, any>, role: 'coach' | 'player' = 'coach') {
  const safe = toPublicTrackerData(db, role);
  const settings = { ...(safe.settings || {}) };
  delete settings.riotIds;
  delete settings.vlr;
  delete settings.ai;
  settings.calendars = Array.isArray(settings.calendars)
    ? settings.calendars.map(({ gcalId: _privateCalendarId, ...calendar }: any) => calendar)
    : [];
  return {
    settings,
    rosterPlayers: structuredClone(safe.rosterPlayers || []),
    coreMemberships: structuredClone(safe.coreMemberships || []),
    tryoutBatches: structuredClone(safe.tryoutBatches || []),
    schedule: (safe.schedule || []).map((item: any) => selectFields(item, ['id', 'date', 'kind', 'primary', 'secondary', 'notes', 'attendance', 'calendarKey'])),
    goals: (safe.goals || []).map((item: any) => selectFields(item, ['id', 'date', 'goal', 'notes', 'status', 'owner'])),
    matches: (safe.matches || []).map((item: any) => selectFields(item, WEBSITE_MATCH_FIELDS)),
    playerStats: (safe.playerStats || []).map((item: any) => selectFields(item, WEBSITE_STAT_FIELDS)),
    soloq: (safe.soloq || []).map((item: any) => selectFields(item, ['id', 'date', 'player', 'wins', 'losses', 'rank', 'rr', 'source'])),
    // Keep the TrackerData shape stable while proving that detailed desktop-only
    // collections are never transferred to the browser summary portal.
    rounds: [], vetos: [], strats: [], stratRuns: [], seasonArchives: [], vodReviews: [], lineups: [],
    secrets: {}, serverTime: new Date().toISOString(),
  };
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
