const crypto = require('node:crypto');

function normalizeName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[right.length];
}

function nameAppears(text, name) {
  const haystack = normalizeName(text); const needle = normalizeName(name);
  if (!needle || needle.length < 3) return false;
  if (haystack.includes(needle)) return true;
  const words = String(text || '').split(/\s+/).map(normalizeName).filter(Boolean);
  return words.some(word => word.length >= 3 && editDistance(word, needle) <= Math.max(1, Math.floor(needle.length * .18)));
}

function orderedNames(text, players) {
  const normalized = normalizeName(text);
  return players.map(player => {
    const needle = normalizeName(player.name); const exact = normalized.indexOf(needle);
    if (exact >= 0) return { ...player, index: exact };
    const rawIndex = String(text || '').toLowerCase().indexOf(String(player.name || '').toLowerCase());
    return nameAppears(text, player.name) ? { ...player, index: rawIndex >= 0 ? rawIndex : Number.MAX_SAFE_INTEGER } : null;
  }).filter(Boolean).sort((a, b) => a.index - b.index);
}

function observationId(kind, timestampMs, text) {
  return crypto.createHash('sha256').update(`${kind}:${Math.round(timestampMs / 250)}:${String(text || '').trim().toLowerCase()}`).digest('hex').slice(0, 24);
}

function parseKillFeedSnapshot(snapshot, players) {
  const lines = String(snapshot.text || '').split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
  const events = [];
  for (const line of lines) {
    const names = orderedNames(line, players);
    if (names.length < 2) continue;
    const killer = names[0]; const victim = names[names.length - 1];
    if (killer.name === victim.name || killer.team === victim.team) continue;
    events.push({
      id: observationId('elimination', snapshot.timestampMs, `${killer.name}:${victim.name}`),
      kind: 'elimination', timestampMs: snapshot.timestampMs, confidence: Math.min(snapshot.confidence ?? .72, .92),
      grade: 'video-observation', killer: killer.name, victim: victim.name, killerTeam: killer.team, victimTeam: victim.team,
      rawText: line,
    });
  }
  return events;
}

function parseObjectiveSnapshot(snapshot) {
  const text = String(snapshot.text || '').toLowerCase(); const events = [];
  const add = kind => events.push({ id: observationId(kind, snapshot.timestampMs, text), kind, timestampMs: snapshot.timestampMs, confidence: snapshot.confidence ?? .76, grade: 'ocr', rawText: snapshot.text });
  if (/spike\s+(planted|plant)/.test(text)) add('plant');
  if (/spike\s+(defused|defuse)|defus(ed|ing)/.test(text)) add('defuse');
  if (/ultimate\s+orb|ult\s+orb|orb\s+captur(ed|e)/.test(text)) add('orb-capture');
  return events;
}

function parseUltimateSnapshots(snapshots, playerName) {
  const states = [];
  for (const snapshot of snapshots) {
    const matches = [...String(snapshot.text || '').matchAll(/(?:ult(?:imate)?\s*)?(\d{1,2})\s*[\/|]\s*(\d{1,2})/gi)];
    if (!matches.length) continue;
    const match = matches[0]; const current = Number(match[1]); const required = Number(match[2]);
    if (current > required || required < 5 || required > 10) continue;
    const previous = states.at(-1);
    if (!previous || previous.current !== current || previous.required !== required) states.push({ id: observationId('ultimate-state', snapshot.timestampMs, `${current}/${required}`), kind: 'ultimate-state', timestampMs: snapshot.timestampMs, confidence: snapshot.confidence ?? .7, grade: 'ocr', player: playerName, current, required, rawText: snapshot.text });
  }
  const uses = []; const candidates = [];
  for (let index = 1; index < states.length; index += 1) {
    const before = states[index - 1]; const after = states[index];
    const gap = after.timestampMs - before.timestampMs;
    if (after.required !== before.required || after.current > 1 || gap <= 0 || gap >= 20_000) continue;
    if (before.current === before.required) uses.push({ id: observationId('ultimate-use', after.timestampMs, playerName), kind: 'ultimate-use', timestampMs: after.timestampMs, confidence: Math.min(before.confidence, after.confidence, .86), grade: 'video-observation', player: playerName });
    else if (before.current === before.required - 1) candidates.push({ id: observationId('ultimate-use-candidate', after.timestampMs, playerName), kind: 'ultimate-use-candidate', timestampMs: after.timestampMs, confidence: Math.min(before.confidence, after.confidence, .55), grade: 'ocr', player: playerName, reason: 'not-confirmed-ready' });
  }
  return { states, uses, candidates };
}

function dedupeEvents(events, windowMs = 5_000) {
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs); const kept = [];
  for (const event of sorted) {
    const duplicate = kept.findLast(item => item.kind === event.kind && item.killer === event.killer && item.victim === event.victim && item.player === event.player && event.timestampMs - item.timestampMs <= windowMs);
    if (!duplicate) kept.push(event);
    else if (event.confidence > duplicate.confidence) Object.assign(duplicate, event);
  }
  return kept;
}

function groupRounds(eliminations, gapMs = 22_000) {
  const rounds = [];
  for (const event of [...eliminations].sort((a, b) => a.timestampMs - b.timestampMs)) {
    const current = rounds.at(-1);
    if (!current || event.timestampMs - current.events.at(-1).timestampMs > gapMs) rounds.push({ roundNumber: rounds.length + 1, startedAtMs: event.timestampMs, endedAtMs: event.timestampMs, events: [event] });
    else { current.events.push(event); current.endedAtMs = event.timestampMs; }
  }
  return rounds;
}

function aggregateVideoEvidence({ players, killFeedSnapshots = [], objectiveSnapshots = [], ultimateSnapshots = [], povPlayerName = null, durationMs = 0 }) {
  const eliminations = dedupeEvents(killFeedSnapshots.flatMap(snapshot => parseKillFeedSnapshot(snapshot, players)));
  const objectives = dedupeEvents(objectiveSnapshots.flatMap(parseObjectiveSnapshot));
  const ultimate = povPlayerName ? parseUltimateSnapshots(ultimateSnapshots, povPlayerName) : { states: [], uses: [], candidates: [] };
  const rounds = groupRounds(eliminations);
  const metrics = players.map(player => {
    const kills = eliminations.filter(event => event.killer === player.name).length;
    const deaths = eliminations.filter(event => event.victim === player.name).length;
    const ultimateUses = ultimate.uses.filter(event => event.player === player.name).length;
    const orbCaptures = objectives.filter(event => event.kind === 'orb-capture' && (!povPlayerName || player.name === povPlayerName)).length;
    let kastSuccessful = 0; let kastCovered = 0; let trades = 0;
    for (const round of rounds) {
      const killed = round.events.some(event => event.killer === player.name); const died = round.events.find(event => event.victim === player.name);
      const traded = !!died && round.events.some(event => event.killerTeam === player.team && event.victim === died.killer && event.timestampMs > died.timestampMs && event.timestampMs - died.timestampMs <= 5_000);
      if (traded) trades += 1;
      if (round.events.some(event => event.killerTeam === player.team || event.victimTeam === player.team)) { kastCovered += 1; if (killed || traded || !died) kastSuccessful += 1; }
    }
    return { playerName: player.name, team: player.team, kills, deaths, trades, ultimateUses: player.name === povPlayerName && ultimate.states.length >= 2 ? ultimateUses : null, orbCaptures: player.name === povPlayerName && orbCaptures > 0 ? orbCaptures : null, kastSuccessful: kastCovered ? kastSuccessful : null, kastCovered: kastCovered || null, kastRate: kastCovered ? Math.round(kastSuccessful / kastCovered * 1000) / 10 : null };
  });
  const expectedTeam = players.filter(player => player.team === 'ours' && Number.isInteger(player.expectedKills) && Number.isInteger(player.expectedDeaths));
  const eliminationComplete = expectedTeam.length === 5 && expectedTeam.every(player => {
    const observed = metrics.find(metric => metric.playerName === player.name); return observed && observed.kills === player.expectedKills && observed.deaths === player.expectedDeaths;
  });
  const coverage = {
    durationMs, killFeedSnapshots: killFeedSnapshots.length, objectiveSnapshots: objectiveSnapshots.length, ultimateSnapshots: ultimateSnapshots.length,
    resolvedEliminations: eliminations.length, inferredRoundGroups: rounds.length,
    temporalAmbiguities: [...new Set(eliminations.map(event => event.timestampMs))].filter(timestamp => eliminations.filter(event => event.timestampMs === timestamp).length > 1).length,
    signals: {
      eliminations: eliminationComplete ? 'complete' : killFeedSnapshots.length ? (eliminations.length ? 'partial' : 'unsupported') : 'unsupported',
      // Scoreboard reconciliation proves event counts, not the exact ordering
      // needed for a five-second trade window. Sampled OCR remains reviewable
      // evidence but can never promote a zero/positive trade count as complete.
      trades: rounds.length ? 'partial' : 'unsupported', kast: rounds.length ? 'partial' : 'unsupported',
      objectives: objectiveSnapshots.length ? 'partial' : 'unsupported', ultimateUse: ultimate.states.length >= 2 ? 'partial' : 'unsupported',
      orbCapture: objectives.some(event => event.kind === 'orb-capture') ? 'partial' : 'unsupported', throws: 'unsupported',
    },
  };
  return { schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', coverage, observations: [...eliminations, ...objectives, ...ultimate.states, ...ultimate.uses, ...ultimate.candidates].sort((a, b) => a.timestampMs - b.timestampMs), rounds, playerMetrics: metrics, throwCandidates: [], limitations: ['Round groups inferred from covered kill-feed activity are not authoritative round boundaries.', 'Sampled kill-feed frames do not prove exact five-second trade timing.', 'Ultimate counter resets remain candidates unless the counter was confirmed fully ready.', 'Invisible or unreadable HUD events remain unknown.', 'Throw intent is never inferred as fact.'] };
}

module.exports = { normalizeName, nameAppears, parseKillFeedSnapshot, parseObjectiveSnapshot, parseUltimateSnapshots, dedupeEvents, groupRounds, aggregateVideoEvidence };
