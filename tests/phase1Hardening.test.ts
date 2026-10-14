import { describe, expect, it } from 'vitest';
import { canonicalizeRoundIdentities, captureConsistencyReport, addSurvivalEvidence } from '../lib/screenshotEvidence';
import { canonicalScoreboardName, confusableCaptureKey, normalizeCaptureName, reconcileCapturedRoundNumbers } from '../lib/scrimCaptureImport';
import { createValorantEndScreenProfile, measureScoreDigitBoxes, parseLocalScoreboardRecognitions } from '../lib/localOcrEngine';

describe('canonical round identities (roster-matched players)', () => {
  // Kill events are classified before roster matching and carry raw
  // `name:<ocr>` keys; players are re-keyed to roster ids afterwards.
  const resolve = (raw: string) => {
    const roster: Record<string, string> = { yehia: 'roster-yehia', kiddouk: 'roster-kiddouk' };
    const key = normalizeCaptureName(raw);
    return { displayName: raw.trim(), playerId: roster[key] || `name:${key}` };
  };
  it('joins kill events to roster ids so survival and FD use the same identity', () => {
    const players = [
      { displayName: 'Yehia', team: 'ours' as const, playerId: 'roster-yehia' },
      { displayName: 'Kiddouk', team: 'ours' as const },
      { displayName: 'Enemy One', team: 'theirs' as const },
    ];
    const events = [
      { sequence: 1, killerPlayerId: 'name:enemy one', victimPlayerId: 'name:yehia', killerTeam: 'theirs' as const, victimTeam: 'ours' as const },
      { sequence: 2, killerPlayerId: 'name:kiddouk', victimPlayerId: 'name:enemy one', killerTeam: 'ours' as const, victimTeam: 'theirs' as const },
    ];
    const result = canonicalizeRoundIdentities({ players, events, resolve });
    expect(result.events[0].victimPlayerId).toBe('roster-yehia');
    expect(result.events[1].killerPlayerId).toBe('roster-kiddouk');
    const survival = addSurvivalEvidence(result.players, result.events, true);
    expect(survival.find(player => player.playerId === 'roster-yehia')?.survived).toBe(false);
    expect(survival.find(player => player.playerId === 'roster-kiddouk')?.survived).toBe(true);
  });
  it('maps rows restored from the final scoreboard', () => {
    const result = canonicalizeRoundIdentities({ players: [], events: [{ sequence: 1, killerPlayerId: 'name:yehia', victimPlayerId: null }], resolve, extraRawNames: ['Yehia'] });
    expect(result.events[0].killerPlayerId).toBe('roster-yehia');
  });
});

describe('capture name matching', () => {
  it('keeps non-Latin names instead of collapsing them to an empty id', () => {
    expect(normalizeCaptureName('ХОРОШАЯ ПОПЫТКА')).toBe('хорошаяпопытка');
    expect(normalizeCaptureName('GLS Madaô')).toBe('glsmadao');
  });
  it('treats OCR look-alike glyphs as the same player', () => {
    expect(confusableCaptureKey('panw1d')).toBe(confusableCaptureKey('panwild'));
    expect(canonicalScoreboardName('panwild', [{ extractedName: 'panw1d' }, { extractedName: 'Wissite' }])).toBe('panw1d');
    expect(canonicalScoreboardName('By crlot', [{ extractedName: 'By cr0ot' }])).toBe('By cr0ot');
  });
});

describe('round re-keying from the printed ROUND header', () => {
  const round = (captured: number, displayed: number | null, confidence = 'high') => ({ roundNo: captured, result: 'W', winBy: 'Elimination', extractionIssues: [] as string[], screenshotEvidence: { displayedRoundNo: displayed, confidence } });
  it('files images shifted by a scrolled timeline under their real round', () => {
    const result = reconcileCapturedRoundNumbers([round(1, 2), round(2, 3), round(3, 4)], 4);
    expect(result.rounds.map(r => r.roundNo)).toEqual([1, 2, 3, 4]);
    expect(result.rounds[0].extractionIssues).toEqual(['round-not-captured']);
    expect(result.rounds[1].extractionIssues).toContain('round-rekeyed-from-header');
    expect(result.missing).toEqual([1]);
    expect(result.rekeyed).toBe(3);
  });
  it('keeps the more confident read of a duplicated round', () => {
    const result = reconcileCapturedRoundNumbers([round(1, 1, 'low'), round(2, 1, 'high')], 1);
    expect(result.rounds).toHaveLength(1);
    expect((result.rounds[0] as any).screenshotEvidence.confidence).toBe('high');
    expect(result.duplicates).toBe(1);
  });
  it('keeps an unreadable header in its click slot but flags it', () => {
    const result = reconcileCapturedRoundNumbers([round(1, null)], 1);
    expect(result.rounds[0].extractionIssues).toContain('round-number-unreadable');
  });
});

describe('consistency checks', () => {
  it('blocks on score contradictions but only warns on small kill/death gaps', () => {
    const players = Array.from({ length: 10 }, () => ({ kills: 16, deaths: 17 }));
    const report = captureConsistencyReport({ ourScore: 13, theirScore: 11, rounds: Array.from({ length: 24 }, (_, i) => ({ result: i < 13 ? 'W' : 'L' })), players });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    const contradiction = captureConsistencyReport({ ourScore: 13, theirScore: 11, rounds: [{ result: 'W' }], players: [] });
    expect(contradiction.errors).toHaveLength(1);
  });
});

describe('competitive scoreboard layout', () => {
  it('reads Trades and Performance Score in their own columns', () => {
    const profile = createValorantEndScreenProfile(1920, 1080, 'competitive');
    const region = (id: string) => profile.regions.find(r => r.id === id)!.rectangle;
    expect(region('player.0.trades').left).toBeLessThan(1169);
    expect(region('player.0.trades').left + region('player.0.trades').width).toBeGreaterThan(1169);
    expect(region('player.0.fk').left).toBeLessThan(1332);
    expect(region('player.0.fk').left + region('player.0.fk').width).toBeGreaterThan(1332);
    expect(region('player.0.defuses').left + region('player.0.defuses').width).toBeGreaterThan(1658);
    const draft = parseLocalScoreboardRecognitions([
      { regionId: 'player.0.name', text: 'Wissite', confidence: 90 },
      { regionId: 'player.0.kda', text: '28 / 17 / 6', confidence: 90 },
      { regionId: 'player.0.trades', text: '7', confidence: 90 },
      { regionId: 'player.0.performanceScore', text: '397', confidence: 90 },
    ] as any, { capturedAt: '2026-10-14T00:00:00Z', rosterPlayers: [] });
    expect(draft.stats[0]).toMatchObject({ kills: 28, deaths: 17, assists: 6, trades: 7, performanceScore: 397 });
  });
  it('keeps the custom layout unchanged for scrims', () => {
    const profile = createValorantEndScreenProfile(1920, 1080);
    expect(profile.id).toBe('valorant-post-match-scoreboard-v1');
    expect(profile.regions.some(r => r.id.endsWith('.trades'))).toBe(false);
  });
});

describe('score digit measurement', () => {
  it('finds both coloured scores wherever the header word puts them', () => {
    const width = 1920; const height = 1080;
    const data = new Uint8ClampedArray(width * height * 4);
    const paint = (x0: number, x1: number, rgb: [number, number, number]) => {
      for (let y = 160; y < 205; y += 1) for (let x = x0; x < x1; x += 1) { const i = (y * width + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
    };
    paint(41, 62, [240, 70, 80]); paint(90, 210, [235, 235, 235]); paint(227, 264, [40, 220, 190]);
    const boxes = measureScoreDigitBoxes({ width, height, data })!;
    expect(boxes.left.left).toBeLessThanOrEqual(41);
    expect(boxes.right.left).toBeLessThanOrEqual(227);
    expect(boxes.right.left + boxes.right.width).toBeGreaterThanOrEqual(264);
    const profile = createValorantEndScreenProfile(1920, 1080, 'custom', boxes);
    expect(profile.regions.find(r => r.id === 'score.right')!.rectangle.left).toBe(boxes.right.left);
  });
});

import { snapToKnownName, VALORANT_WEAPON_NAMES, VALORANT_ARMOR_NAMES } from '../lib/localRoundOcrEngine';
describe('equipment OCR snapping', () => {
  it('maps real misreads from captures onto the weapon list', () => {
    expect(snapToKnownName('host', VALORANT_WEAPON_NAMES)).toBe('Ghost');
    expect(snapToKnownName('Fuardian', VALORANT_WEAPON_NAMES)).toBe('Guardian');
    expect(snapToKnownName('zuardian', VALORANT_WEAPON_NAMES)).toBe('Guardian');
    expect(snapToKnownName('ut law', VALORANT_WEAPON_NAMES)).toBe('Outlaw');
    expect(snapToKnownName('Heavy Armer', VALORANT_ARMOR_NAMES)).toBe('Heavy Armor');
    expect(snapToKnownName('xq', VALORANT_WEAPON_NAMES)).toBe('xq');
  });
});

import { inferStartingSide } from '../lib/scrimCaptureImport';
import { parseObjectiveLabel } from '../lib/localRoundOcrEngine';
describe('starting side from spike plants and defuses', () => {
  const round = (roundNo: number, type: 'plant' | 'defuse', team: 'ours' | 'theirs') => ({ roundNo, screenshotEvidence: { objectives: [{ type, team }] } });
  it('reads attackers from plants across halves and overtime', () => {
    expect(inferStartingSide([round(2, 'plant', 'ours'), round(5, 'defuse', 'theirs'), round(14, 'plant', 'theirs'), round(25, 'plant', 'ours')])).toMatchObject({ firstHalf: 'Att', votes: 4 });
    expect(inferStartingSide([round(3, 'plant', 'theirs'), round(15, 'plant', 'ours')])).toMatchObject({ firstHalf: 'Def' });
  });
  it('refuses to guess when evidence conflicts or is thin', () => {
    expect(inferStartingSide([round(2, 'plant', 'ours'), round(3, 'plant', 'theirs')]).firstHalf).toBeNull();
    expect(inferStartingSide([round(2, 'plant', 'ours')]).firstHalf).toBeNull();
  });
  it('parses damaged objective labels', () => {
    expect(parseObjectiveLabel('Planted')).toBe('plant');
    expect(parseObjectiveLabel('Plant ed')).toBe('plant');
    expect(parseObjectiveLabel('Defuscd')).toBe('defuse');
    expect(parseObjectiveLabel('18')).toBeNull();
  });
});
