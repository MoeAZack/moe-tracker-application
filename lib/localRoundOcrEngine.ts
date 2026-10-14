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
  evidence: RoundScreenshotEvidence;
  issues: string[];
}

/** Parse column OCR without repairing or inventing missing cells. */
export function parseLocalRoundRecognitions(recognitions: readonly LocalOcrRecognition[], sourceImage?: string): LocalRoundDraft {
  const byId = new Map(recognitions.map(item => [item.regionId, item]));
  const resultText = byId.get('round.result')?.text.toUpperCase() || '';
  const result = /\bWIN\b|VICTORY/.test(resultText) ? 'W' : /\bLOSS\b|DEFEAT/.test(resultText) ? 'L' : null;
  const names = lines(byId.get('players.names')?.text || '');
  const kills = integers(byId.get('players.kills')?.text || '');
  const assists = integers(byId.get('players.assists')?.text || '');
  const economy = currencyIntegers(byId.get('players.economy')?.text || '');
  const equipment = lines(byId.get('players.equipment')?.text || '');
  const averages = [
    byId.get('averages.ourLoadout')?.text,
    byId.get('averages.enemyLoadout')?.text,
    byId.get('averages.ourBank')?.text,
    byId.get('averages.enemyBank')?.text,
  ].map(value => currencyIntegers(value || '')[0] ?? null);
  const issues: string[] = [];
  if (!result) issues.push('round-result');
  if (names.length !== 10) issues.push('player-names');
  if (kills.length !== 10) issues.push('kills');
  if (assists.length !== 10) issues.push('assists');
  if (economy.length !== 20) issues.push('economy');
  if (equipment.length !== 20) issues.push('equipment');
  if (averages.some(value => value === null)) issues.push('team-averages');
  const rowCount = Math.min(10, names.length, kills.length, assists.length);
  const confidenceValues = recognitions.map(item => item.confidence).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const confidence = confidenceValues.length && Math.min(...confidenceValues) >= 85 && issues.length === 0 ? 'high' : confidenceValues.length && Math.min(...confidenceValues) >= 65 ? 'medium' : 'low';
  return {
    result,
    issues,
    evidence: {
      schemaVersion: 1, reviewStatus: 'review-required', confidence, sourceImage,
      ourAverageLoadout: averages[0], enemyAverageLoadout: averages[1],
      ourAverageBank: averages[2], enemyAverageBank: averages[3],
      players: Array.from({ length: rowCount }, (_, row) => ({
        displayName: names[row], team: row < 5 ? 'ours' : 'theirs', kills: kills[row] ?? null, assists: assists[row] ?? null,
        loadoutValue: economy[row * 2] ?? null, bank: economy[row * 2 + 1] ?? null,
        equippedWeapon: equipment[row * 2] ?? null, armor: equipment[row * 2 + 1] ?? null,
      })),
      events: [],
    },
  };
}
