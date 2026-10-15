const APPEARANCE_TYPES = new Set(['core', 'tryout', 'standIn']);

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function preserveExistingRosterContext(existingMatch: any, submittedMatch: any) {
  if (existingMatch?.rosterContext) submittedMatch.rosterContext = existingMatch.rosterContext;
  else submittedMatch.rosterContext = { kind: 'unclassified' };
}

export function validateAndNormalizeLineup(db: any, match: any, stats: any[]) {
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
    if (!stat.playerId) {
      if (stat.appearanceType) fail('An unlinked appearance cannot claim a roster status.');
      const observedName = typeof stat.displayNameSnapshot === 'string' && stat.displayNameSnapshot.trim()
        ? stat.displayNameSnapshot.trim()
        : typeof stat.player === 'string' ? stat.player.trim() : '';
      if (!observedName) fail('Each unlinked appearance requires an observed name.');
      return { ...stat, player: observedName, displayNameSnapshot: observedName };
    }
    if (!stat.playerId || !stat.appearanceType) fail('Each confirmed appearance requires a player ID and appearance type.');
    const player = (db.rosterPlayers || []).find((entry: any) => entry.id === stat.playerId);
    if (!player) fail('A player appearance references an unknown roster identity.');
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
