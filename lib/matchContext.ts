import { activeCorePlayerIds, ensureObservedRosterPlayer, setObservedRosterStatus, setTryoutsMode } from './roster';

const APPEARANCE_TYPES = new Set(['core', 'tryout', 'standIn']);

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function preserveExistingRosterContext(existingMatch: any, submittedMatch: any) {
  if (existingMatch?.rosterContext) submittedMatch.rosterContext = existingMatch.rosterContext;
  else submittedMatch.rosterContext = { kind: 'unclassified' };
}

export function validateAndNormalizeLineup(db: any, match: any, stats: any[], existingStats: any[] = []) {
  // A coach-confirmed scoreboard is identity evidence: every allied observed
  // name belongs in the profile library, even when twenty other profiles
  // already exist. Do this before lineup validation so the same save also
  // materializes canonical playerStats instead of leaving anonymous rows.
  if (match.sourceMetadata?.method === 'screenshot' && match.reviewConfirmation?.alliedSideConfirmed) {
    const coreIds = activeCorePlayerIds(db);
    const hasObservedNames = stats.some(stat => String(stat.displayNameSnapshot || stat.player || '').trim());
    const tryoutBatch = !coreIds.size && hasObservedNames ? setTryoutsMode(db, true).batch : null;
    stats = stats.map(stat => {
      if (stat.playerId) return stat;
      const observedName = typeof stat.displayNameSnapshot === 'string' && stat.displayNameSnapshot.trim()
        ? stat.displayNameSnapshot.trim()
        : typeof stat.player === 'string' ? stat.player.trim() : '';
      if (!observedName) return stat;
      const player = ensureObservedRosterPlayer(db, observedName);
      const appearanceType = coreIds.has(player.id) ? 'core' : coreIds.size ? 'standIn' : 'tryout';
      if (!player.rosterStatus) setObservedRosterStatus(db, { playerId: player.id, displayName: player.displayName, status: appearanceType });
      return { ...stat, playerId: player.id, appearanceType };
    });
    match.rosterContext = tryoutBatch ? { kind: 'tryout', tryoutBatchId: tryoutBatch.id } : { kind: 'mixed' };
  }
  const context = match.rosterContext || { kind: 'unclassified' };
  match.rosterContext = context;

  if (context.tryoutBatchId) {
    const batch = (db.tryoutBatches || []).find((entry: any) => entry.id === context.tryoutBatchId);
    if (!batch) fail('The selected tryout batch does not exist.');
  }

  if (context.kind === 'unclassified') {
    if (stats.some(stat => stat.playerId || stat.appearanceType)) {
      fail('Linked player appearances require a classified match roster context.');
    }
    return stats.map(stat => {
      const observedName = typeof stat.displayNameSnapshot === 'string' && stat.displayNameSnapshot.trim()
        ? stat.displayNameSnapshot.trim()
        : typeof stat.player === 'string' ? stat.player.trim() : '';
      return observedName ? { ...stat, player: observedName, displayNameSnapshot: observedName } : stat;
    });
  }

  const batch = context.tryoutBatchId
    ? (db.tryoutBatches || []).find((entry: any) => entry.id === context.tryoutBatchId)
    : undefined;

  return stats.map(stat => {
    const existing = stat.id ? existingStats.find((row: any) => row.id === stat.id) : undefined;
    if (!stat.playerId) {
      if (stat.appearanceType && !existing) fail('An unlinked appearance cannot claim a roster status.');
      const observedName = typeof stat.displayNameSnapshot === 'string' && stat.displayNameSnapshot.trim()
        ? stat.displayNameSnapshot.trim()
        : typeof stat.player === 'string' ? stat.player.trim() : '';
      if (!observedName) fail('Each unlinked appearance requires an observed name.');
      return { ...stat, player: observedName, displayNameSnapshot: observedName };
    }
    if (!stat.playerId || !stat.appearanceType) fail('Each confirmed appearance requires a player ID and appearance type.');
    const player = (db.rosterPlayers || []).find((entry: any) => entry.id === stat.playerId);
    if (!player) fail('A player appearance references an unknown roster identity.');
    if (player.retiredAt && existing?.playerId !== player.id) fail('New appearances cannot link to an archived roster identity.');
    if (!APPEARANCE_TYPES.has(stat.appearanceType)) fail('Player appearance type is invalid.');
    if (stat.appearanceType === 'tryout') {
      if (!batch) fail('A tryout appearance requires a selected tryout batch.');
      if (!batch.candidatePlayerIds.includes(stat.playerId)) fail('A tryout appearance must belong to the selected batch.');
    }
    if (context.kind === 'core' && stat.appearanceType !== 'core') fail('Core context can contain only core appearances.');
    if (context.kind === 'tryout' && stat.appearanceType !== 'tryout') fail('Tryout context can contain only tryout appearances.');
    const observedName = typeof stat.displayNameSnapshot === 'string' && stat.displayNameSnapshot.trim()
      ? stat.displayNameSnapshot.trim()
      : player.displayName;
    return {
      ...stat,
      player: observedName,
      displayNameSnapshot: observedName,
    };
  });
}
