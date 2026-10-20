// Synthetic stand-in for the audited live pair: one finished game captured
// twice, days apart. Names, numbers and IDs are invented; no owner data.
const ours = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const theirs = ['Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
const board = [
  ...ours.map((name, index) => ({ name, allied: true, kills: 20 - index * 3, deaths: 15 + index, assists: 3 + index, fk: 4 - (index % 3), plants: index % 2, defuses: index === 0 ? 1 : 0 })),
  ...theirs.map((name, index) => ({ name, allied: false, kills: 22 - index * 4, deaths: 16 + index, assists: 2 + index, fk: 3 - (index % 2), plants: index % 2, defuses: 0 })),
];
export const rosterIds = Object.fromEntries(ours.map((name, index) => [name, `00000000-0000-4000-8000-00000000010${index}`]));
const playerId = (name: string) => ours.includes(name) ? rosterIds[name] : `name:${name}`;
const results = 'WWLWWWLWWLWWLLWLWLLWWLWW'.split('') as Array<'W' | 'L'>;

function round(roundNo: number, capture: 'first' | 'second') {
  const result = results[roundNo - 1];
  const killers = result === 'W' ? ours : theirs; const victims = result === 'W' ? theirs : ours;
  // Ordered kill feed: identical in both captures; 7 kills per round = 168 for 24 rounds.
  const events = Array.from({ length: 7 }, (_, index) => {
    const killer = (index % 3 === 2 ? victims : killers)[(roundNo + index) % 5]; const victim = (index % 3 === 2 ? killers : victims)[(roundNo * 2 + index) % 5];
    return { sequence: index + 1, sourceRow: index, killerPlayerId: playerId(killer), victimPlayerId: playerId(victim), killerTeam: ours.includes(killer) ? 'ours' : 'theirs', victimTeam: ours.includes(victim) ? 'ours' : 'theirs', weapon: 'Vandal' };
  });
  // OCR noise between captures: economy in four rounds, confidence floats and loadouts everywhere.
  const noisy = capture === 'second' && [3, 9, 14, 20].includes(roundNo);
  return {
    roundNo, side: roundNo <= 12 ? 'Attack' : 'Defense', result, winBy: result === 'W' ? 'Elimination' : 'Defuse',
    buy: noisy ? 'Half' : 'Full', enemyBuy: 'Full',
    screenshotEvidence: {
      schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'high', openingEventComplete: true,
      fieldConfidence: { result: capture === 'first' ? 0.91 : 0.87, events: capture === 'first' ? 0.82 : 0.79 },
      ourAverageLoadout: noisy ? 2900 : 3900, enemyAverageLoadout: 3800,
      players: [...ours, ...theirs].map(name => ({ playerId: playerId(name), displayName: name, team: ours.includes(name) ? 'ours' : 'theirs', equippedWeapon: 'Vandal', loadoutValue: noisy ? 2400 : 3900 + (capture === 'first' ? 0 : 50) })),
      events,
    },
  };
}

export function recaptureMatch(id: string, capture: 'first' | 'second') {
  return {
    id, date: capture === 'first' ? '2026-01-15' : '2026-01-18', type: 'Scrim', opponent: 'Synthetic Opponent',
    map: capture === 'first' ? 'Ascent' : 'Lotus', rosterContext: { kind: 'core' as const }, ourScore: 15, theirScore: 9, attW: null, attL: null, defW: null, defL: null,
    screenshotEvidence: { schemaVersion: 1, captureId: `synthetic-capture-${capture}`, scoreboardPlayers: board.map(row => ({ ...row, agent: null, trades: null })) },
  };
}

export function recaptureRounds(matchId: string, capture: 'first' | 'second') {
  return results.map((_, index) => ({ id: `${matchId}-r${index + 1}`, matchId, ...round(index + 1, capture) }));
}

export const recaptureRoster = () => ours.map(name => ({ id: rosterIds[name], displayName: name, createdAt: '2026-01-01' }));

export function recaptureStats(matchId: string) {
  return ours.map((name, index) => ({ id: `${matchId}-s${index}`, matchId, playerId: rosterIds[name], player: name, displayNameSnapshot: name, appearanceType: 'core' as const, kills: board[index].kills, deaths: board[index].deaths, assists: board[index].assists, fd: null }));
}
