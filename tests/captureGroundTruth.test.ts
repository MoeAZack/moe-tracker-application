import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('labelled capture corpus contract', () => {
  it('keeps explicit human labels for screenshot regression backtests', () => {
    const corpus = JSON.parse(readFileSync(new URL('./fixtures/capture-ground-truth.json', import.meta.url), 'utf8'));
    expect(corpus.schemaVersion).toBe(2);
    expect(corpus.sessions.length).toBeGreaterThan(0);
    for (const session of corpus.sessions) {
      expect(session.captureId).toMatch(/^Scrim-\d{8}-\d{6}$/);
      expect(session.score[0] + session.score[1]).toBe(session.roundCount);
      expect(session.players).toHaveLength(5);
      expect(new Set(session.players.map((player: any) => player.name)).size).toBe(5);
      expect(session.labelStatus).toBe('human-verified');
      expect(session.clientLanguage).toBeTruthy();
      expect(session.layout).toMatch(/^(custom|competitive)$/);
    }
  });
});
