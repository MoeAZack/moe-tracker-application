import { readFile } from 'node:fs/promises';
import path from 'node:path';

const port = process.argv[2];
if (!port) throw new Error('Pass the installed local-service port.');
const root = process.cwd();
const result = JSON.parse(await readFile(path.join(root, 'release', 'capture-backtest-result.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'moe-tracker-application', 'Local Workspace', 'desktop-config.json'), 'utf8'));
const origin = `http://127.0.0.1:${port}`;
const login = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: config.adminPassword }) });
if (!login.ok) throw new Error(`Installed service login failed (${login.status}).`);
const token = (await login.json()).key;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const score = result.draft.match;
const sourceMetadata = result.draft.sourceMetadata;
const agentEvidence = new Map(Object.entries({ Yehia: 'Cypher', Kiddouk: 'Jett', 'John Kramer': 'Phoenix', 'RAF BLACK': 'Omen', 'GLS Block': 'Sova' }));
const stats = result.players.filter(player => player.include).map(player => ({
  player: player.extractedName, agent: agentEvidence.get(player.extractedName) || '',
  kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
  kills: player.kills, deaths: player.deaths, assists: player.assists, fk: player.fk, fd: player.fd,
  plants: player.plants, defuses: player.defuses, acs: null, adr: null, hs: null, sourceMetadata,
}));
const wins = result.rounds.filter(round => round.result === 'W').length;
const losses = result.rounds.filter(round => round.result === 'L').length;
const matchResponse = await fetch(`${origin}/api/save-match`, { method: 'POST', headers, body: JSON.stringify({
  match: { date: new Date().toISOString().slice(0, 10), type: 'Scrim', opponent: 'Capture backtest', map: score.map, ourScore: score.ourScore, theirScore: score.theirScore, attW: result.rounds.slice(0, 12).filter(round => round.result === 'W').length, attL: result.rounds.slice(0, 12).filter(round => round.result === 'L').length, defW: wins - result.rounds.slice(0, 12).filter(round => round.result === 'W').length, defL: losses - result.rounds.slice(0, 12).filter(round => round.result === 'L').length, source: 'scrim-import', sourceMetadata, rosterContext: { kind: 'unclassified' }, reviewConfirmation: { alliedSideConfirmed: true } },
  statsUpdate: { operation: 'replace', stats },
}) });
const saved = await matchResponse.json();
if (!matchResponse.ok) throw new Error(saved.error || `Save match failed (${matchResponse.status}).`);
const matchId = saved.match?.id || saved.id;
const tier = weapon => {
  const text = String(weapon || '').toLowerCase();
  if (/vandal|phantom|operator|odin|guardian|outlaw|bandit/.test(text)) return 'Full';
  if (/spectre|stinger|bulldog|judge|bucky|marshal|ares/.test(text)) return 'Low';
  if (/classic|ghost|sheriff|frenzy|shorty/.test(text)) return 'Eco';
  return '';
};
const teamBuy = (evidence, team) => {
  const values = evidence.players.filter(player => player.team === team).map(player => tier(player.equippedWeapon)).filter(Boolean);
  const full = values.filter(value => value === 'Full').length; const low = values.filter(value => value === 'Low').length; const eco = values.filter(value => value === 'Eco').length;
  return full >= 3 ? 'Full' : full + low >= 3 ? (full ? 'Half' : 'Low') : eco >= 3 ? 'Eco' : '';
};
const rows = result.rounds.map(round => ({ roundNo: round.roundNo, side: round.roundNo <= 12 ? 'Att' : 'Def', result: round.result, winBy: '', buy: teamBuy(round.screenshotEvidence, 'ours'), enemyBuy: teamBuy(round.screenshotEvidence, 'theirs'), screenshotEvidence: { ...round.screenshotEvidence, reviewStatus: 'confirmed' } }));
const roundsResponse = await fetch(`${origin}/api/save-rounds`, { method: 'POST', headers, body: JSON.stringify({ matchId, rows }) });
const roundsSaved = await roundsResponse.json();
if (!roundsResponse.ok) throw new Error(roundsSaved.error || `Save rounds failed (${roundsResponse.status}).`);
console.log(JSON.stringify({ matchId, map: score.map, score: [score.ourScore, score.theirScore], players: stats.length, rounds: rows.length, buys: rows.filter(row => row.buy).length, screenshotMetrics: roundsSaved.screenshotSummary?.playerStats?.length || 0 }));
