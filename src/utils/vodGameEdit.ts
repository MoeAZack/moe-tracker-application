import type { VodBatchGame } from './vodImportRunner';
import { loadMapReadSamples, recordMapCorrection, saveMapReadSamples } from './vodMapLearning';

export type VodGameEdit = { map: string; opponent: string; ourScore: number | null; theirScore: number | null };

const score = (value: number | null) => value === null || (Number.isInteger(value) && value >= 0 && value <= 100);

/**
 * Saves a coach's correction of one imported game to its saved match and, when
 * the map changed on a game with an agent-select read, teaches that read.
 * Returns the card's new fields.
 */
export async function saveVodGameEdit(game: VodBatchGame, edit: VodGameEdit, apiFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  if (!game.matchId) throw new Error('This game is not saved yet. Try again once its card shows it was imported.');
  if (!edit.map.trim()) throw new Error('Pick the map.');
  if (!score(edit.ourScore) || !score(edit.theirScore) || (edit.ourScore === null) !== (edit.theirScore === null)) throw new Error('Enter both scores as whole numbers from 0 to 100, or leave both empty.');
  const dataResponse = await apiFetch('/api/data');
  if (!dataResponse.ok) throw new Error('Could not load the saved game. Try again in a moment.');
  const data = await dataResponse.json();
  const existing = (data.matches || []).find((match: any) => match.id === game.matchId);
  if (!existing) throw new Error('The saved game was not found; it may have been removed.');
  const match = { ...existing, map: edit.map.trim(), opponent: edit.opponent.trim() || existing.opponent || '', ourScore: edit.ourScore, theirScore: edit.theirScore, scoreConfirmed: true };
  const response = await apiFetch('/api/save-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match, statsUpdate: { operation: 'preserve' } }) });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'The correction could not be saved.'); }
  const mapChanged = match.map !== game.map;
  let learned: string[] = [];
  if (mapChanged && game.mapRead?.length) {
    const result = recordMapCorrection(loadMapReadSamples(), { source: game.matchId, mapRead: game.mapRead, firedTokens: game.firedTokens, map: match.map });
    saveMapReadSamples(result.samples); learned = result.learned;
  }
  const patch: Partial<VodBatchGame> = {
    map: match.map,
    score: match.ourScore === null ? 'Score pending' : `${match.ourScore}–${match.theirScore}`,
    status: game.status.endsWith(' · corrected by you') ? game.status : `${game.status} · corrected by you`,
    edited: true,
  };
  return { patch, learned };
}
