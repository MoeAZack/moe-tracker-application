import { describe, expect, it } from 'vitest';
import { autonomousCaptureDecision, canonicalKnownMap, consensusDisplayName, mergeScoreboardFallback, recognitionCacheKey, shouldRequestCloudFallback, validCachedRecognitions } from '../lib/ocrAutonomy';
import { chooseRecognitionConsensus, createValorantPerformanceProfile } from '../lib/localOcrEngine';

const complete = () => ({
  meta: { map: 'ascenT', ourScore: 13, theirScore: 9 },
  startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
  players: Array.from({ length: 10 }, (_, index) => ({ include: index < 5, matchedPlayerId: index < 5 ? `p${index}` : null, extractedName: `Player ${index}`, kills: 10 + index, deaths: 8, assists: 4 })),
  rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', screenshotEvidence: { reviewStatus: 'confirmed' } })),
});

describe('OCR autonomy contracts', () => {
  it('normalizes only a unique configured map', () => {
    expect(canonicalKnownMap('ascenT', ['Ascent', 'Bind'])).toBe('Ascent');
    expect(canonicalKnownMap('As', ['Ascent', 'Abyss'])).toBeNull();
  });

  it('uses repeated cross-frame spelling without overriding a configured preferred name', () => {
    expect(consensusDisplayName(['cael1a', 'caelia', 'caelia'])).toBe('caelia');
    expect(consensusDisplayName(['caelia', 'caelia'], 'Caelia')).toBe('Caelia');
  });

  it('allows zero-confirmation save only for complete consistent evidence', () => {
    expect(autonomousCaptureDecision(complete(), ['Ascent'], []).automatic).toBe(true);
    const missing = complete(); missing.rounds[4].screenshotEvidence.reviewStatus = 'review-required';
    expect(autonomousCaptureDecision(missing, ['Ascent'], [])).toMatchObject({ automatic: false, reasons: expect.arrayContaining(['round-evidence-needs-review']) });
  });

  it('versions cached recognition by image, geometry and recognition pipeline', () => {
    const profile = createValorantPerformanceProfile(1920, 1080); const imageSha256 = 'a'.repeat(64); const key = recognitionCacheKey(imageSha256, profile);
    const record = { schemaVersion: 1 as const, key, imageSha256, profile: { id: profile.id, version: profile.version, width: 1920, height: 1080 }, recognitionVersion: 'tesseract-7-eng-1/valorant-fields-v3', recognitions: [{ regionId: 'performance.score', text: '311', confidence: 91 }], createdAt: '2026-10-18T00:00:00.000Z', lastUsedAt: '2026-10-18T00:00:00.000Z' };
    expect(validCachedRecognitions(record, imageSha256, profile)).toBe(true);
    expect(validCachedRecognitions({ ...record, recognitionVersion: 'old' }, imageSha256, profile)).toBe(false);
  });

  it('never invokes cloud fallback unless the coach enabled it and local retries were exhausted', () => {
    expect(shouldRequestCloudFallback('local-only', 5, 3)).toBe(false);
    expect(shouldRequestCloudFallback('local-then-cloud', 1, 3)).toBe(false);
    expect(shouldRequestCloudFallback('local-then-cloud', 2, 0)).toBe(false);
    expect(shouldRequestCloudFallback('local-then-cloud', 2, 3)).toBe(true);
  });

  it('merges cloud facts only through configured maps, complete round score and unique KDA rows', () => {
    const local = complete(); local.meta.map = 'Asoent'; local.meta.ourScore = 9; local.meta.theirScore = 13;
    const fallback = { match: { map: 'Ascent', ourScore: 13, theirScore: 9 }, stats: [{ extractedName: 'Correct Name', agent: 'Sova', kills: 10, deaths: 8, assists: 4, matchedPlayerId: 'p0' }], sourceMetadata: { provider: 'gemini' } };
    const merged = mergeScoreboardFallback(local, fallback, ['Ascent']);
    expect(merged.meta).toMatchObject({ map: 'Ascent', ourScore: 13, theirScore: 9 });
    expect(merged.players[0]).toMatchObject({ extractedName: 'Correct Name', matchedPlayerId: 'p0', fallbackSource: 'gemini-scoreboard' });
  });

  it('accepts agreeing numeric passes and rejects close conflicting guesses', () => {
    expect(chooseRecognitionConsensus([{ text: '17', confidence: 51 }, { text: '17', confidence: 89 }], /^\d+$/)).toMatchObject({ text: '17', agreed: true });
    expect(chooseRecognitionConsensus([{ text: '17', confidence: 71 }, { text: '11', confidence: 69 }], /^\d+$/).text).toBe('');
    expect(chooseRecognitionConsensus([{ text: '17', confidence: 88 }, { text: '11', confidence: 60 }], /^\d+$/).text).toBe('17');
  });
});
