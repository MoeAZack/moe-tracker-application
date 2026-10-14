import type { LocalOcrRecognition } from './localOcrEngine';
import type { RoundScreenshotEvidence } from '../src/types';

const lines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const integers = (value: string) => (value.match(/\d{1,5}/g) || []).map(Number);
// Currency columns use values such as "$4,100". Treat the thousands separator
// as part of one cell instead of incorrectly producing 4 and 100.
const currencyIntegers = (value: string) => (value.match(/\d[\d,.]{0,8}/g) || [])
  .map(token => Number(token.replace(/[^\d]/g, '')))
  .filter(Number.isFinite);

export interface LocalRoundDraft {
  result: 'W' | 'L' | null;
  winBy: string | null;
  displayedRoundNo: number | null;
  eventDetails: Array<{ sourceRow: number; occurredAtSeconds: number | null; distanceMeters: number | null }>;
  evidence: RoundScreenshotEvidence;
  issues: string[];
}

export function parseRoundOutcome(value: string): { result: 'W' | 'L' | null; winBy: string | null } {
  const normalized = value.toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const result = /\bWIN\b|\bVICTORY\b/.test(normalized) ? 'W' : /\bLOSS\b|\bDEFEAT\b/.test(normalized) ? 'L' : null;
  const winBy = /ELIMINAT/.test(normalized) ? 'Elimination'
    : /DEFUS/.test(normalized) ? 'Defuse'
      : /DETONAT|SPIKE/.test(normalized) ? 'Spike'
        : /TIME/.test(normalized) ? 'Time' : null;
  return { result, winBy };
}

const parseTimestamp = (value: string) => {
  const match = value.replace(/[Oo]/g, '0').match(/(?:^|\D)(\d{1,2})\s*[:.]\s*(\d{2})(?:\D|$)/);
  const digits = value.replace(/[^0-9]/g, '');
  const seconds = match ? Number(match[1]) * 60 + Number(match[2])
    : digits.length === 2 ? Number(digits)
      : digits.length >= 3 && digits.length <= 4 ? Number(digits.slice(0, -2)) * 60 + Number(digits.slice(-2)) : null;
  if (seconds === null || Number(digits.slice(-2)) > 59) return null;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 300 ? seconds : null;
};

const parseDistance = (value: string) => {
  const match = value.match(/\d{1,3}/);
  const distance = match ? Number(match[0]) : null;
  return distance !== null && distance >= 0 && distance <= 200 ? distance : null;
};

/** Parse column OCR without repairing or inventing missing cells. */
export const VALORANT_WEAPON_NAMES = ['Classic', 'Shorty', 'Frenzy', 'Ghost', 'Sheriff', 'Bandit', 'Stinger', 'Spectre', 'Bucky', 'Judge', 'Bulldog', 'Guardian', 'Phantom', 'Vandal', 'Marshal', 'Outlaw', 'Operator', 'Ares', 'Odin', 'Melee'];
export const VALORANT_ARMOR_NAMES = ['Heavy Armor', 'Light Armor', 'Regen Shield', 'None'];

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]; previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

/**
 * Snap OCR text of a small closed vocabulary ("host" -> Ghost, "Fuardian" ->
 * Guardian, "ut law" -> Outlaw). Only a unique nearest name within two edits
 * is accepted; anything else stays as read so the review can flag it.
 */
export function snapToKnownName(raw: string | null, names: readonly string[]): string | null {
  if (!raw) return null;
  const key = raw.toLocaleLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  const ranked = names.map(name => ({ name, distance: editDistance(key, name.toLocaleLowerCase().replace(/[^a-z]/g, '')) })).sort((a, b) => a.distance - b.distance);
  const [best, next] = ranked;
  if (best.distance === 0) return best.name;
  if (best.distance <= 2 && key.length >= 3 && (!next || next.distance > best.distance)) return best.name;
  return raw.trim();
}

export function parseLocalRoundRecognitions(recognitions: readonly LocalOcrRecognition[], sourceImage?: string): LocalRoundDraft {
  const byId = new Map(recognitions.map(item => [item.regionId, item]));
  const resultText = byId.get('round.result')?.text || '';
  const { result, winBy } = parseRoundOutcome(resultText);
  const displayedRoundNo = Number(resultText.match(/ROUND\s+(\d{1,2})/i)?.[1] || '') || null;
  const names = lines(byId.get('players.names')?.text || '');
  const kills = integers(byId.get('players.kills')?.text || '');
  const assists = integers(byId.get('players.assists')?.text || '');
  const economy = Array.from({ length: 10 }, (_, row) => ({
    loadout: currencyIntegers(byId.get(`player.${row}.loadout`)?.text || '')[0] ?? null,
    bank: currencyIntegers(byId.get(`player.${row}.bank`)?.text || '')[0] ?? null,
  }));
  const equipment = Array.from({ length: 10 }, (_, row) => ({
    weapon: snapToKnownName(lines(byId.get(`player.${row}.weapon`)?.text || '')[0] || null, VALORANT_WEAPON_NAMES),
    armor: snapToKnownName(lines(byId.get(`player.${row}.armor`)?.text || '')[0] || null, VALORANT_ARMOR_NAMES),
  }));
  const averages: Array<number | null> = [
    byId.get('averages.ourLoadout')?.text,
    byId.get('averages.enemyLoadout')?.text,
    byId.get('averages.ourBank')?.text,
    byId.get('averages.enemyBank')?.text,
  ].map(value => currencyIntegers(value || '')[0] ?? null);
  const issues: string[] = [];
  if (!result) issues.push('round-result');
  if (result && !winBy) issues.push('win-reason');
  if (names.length !== 10) issues.push('player-names');
  if (kills.length !== 10) issues.push('kills');
  if (assists.length !== 10) issues.push('assists');
  if (economy.some(row => row.loadout === null || row.bank === null)) issues.push('economy');
  if (equipment.some(row => !row.weapon || !row.armor)) issues.push('equipment');
  const average = (values: Array<number | null>) => values.every((value): value is number => value !== null) ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  averages[0] ??= average(economy.slice(0, 5).map(row => row.loadout));
  averages[1] ??= average(economy.slice(5).map(row => row.loadout));
  averages[2] ??= average(economy.slice(0, 5).map(row => row.bank));
  averages[3] ??= average(economy.slice(5).map(row => row.bank));
  if (averages.some(value => value === null)) issues.push('team-averages');
  const rowCount = Math.min(10, names.length, kills.length, assists.length);
  const confidenceValues = recognitions.filter(item => !item.regionId.startsWith('event.') && item.text.trim().length > 0).map(item => item.confidence).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const averageConfidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
  const reliableShare = confidenceValues.length ? confidenceValues.filter(value => value >= 65).length / confidenceValues.length : 0;
  // VALORANT's compact antialiased font often receives a pessimistic raw
  // Tesseract score even when the value parses and all row counts reconcile.
  // Structural completeness is the acceptance gate; raw scores remain stored
  // per field for targeted review and diagnostics.
  const majorIssue = issues.some(issue => ['round-result', 'player-names', 'kills', 'assists', 'economy', 'equipment'].includes(issue));
  const confidence = issues.length === 0 ? 'high' : !majorIssue && averageConfidence >= 45 && reliableShare >= .4 ? 'medium' : 'low';
  return {
    result, winBy, displayedRoundNo,
    eventDetails: Array.from({ length: 11 }, (_, sourceRow) => ({
      sourceRow,
      occurredAtSeconds: parseTimestamp(byId.get(`event.${sourceRow}.timestamp`)?.text || ''),
      distanceMeters: parseDistance(byId.get(`event.${sourceRow}.distance`)?.text || ''),
    })),
    issues,
    evidence: {
      schemaVersion: 1, reviewStatus: 'review-required', confidence, sourceImage, displayedRoundNo,
      fieldConfidence: Object.fromEntries(recognitions.map(item => [item.regionId, item.confidence])),
      extractionIssues: issues,
      ourAverageLoadout: averages[0], enemyAverageLoadout: averages[1],
      ourAverageBank: averages[2], enemyAverageBank: averages[3],
      players: Array.from({ length: rowCount }, (_, row) => ({
        displayName: names[row], team: row < 5 ? 'ours' : 'theirs', kills: kills[row] ?? null, assists: assists[row] ?? null,
        loadoutValue: economy[row]?.loadout ?? null, bank: economy[row]?.bank ?? null,
        equippedWeapon: equipment[row]?.weapon ?? null, armor: equipment[row]?.armor ?? null,
      })),
      events: [],
    },
  };
}
