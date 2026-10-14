import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { refreshScreenshotOutboxFromData } = require('../desktop/sync-outbox.cjs');

describe('desktop screenshot sync outbox', () => {
  it('drops deleted matches, coalesces duplicates, and refreshes all current player summaries', () => {
    const stale = (matchId: string, id: string) => ({ id, kind: 'screenshot-summary', matchId, summary: { playerStats: [{ player: 'Old' }] }, createdAt: '2026-01-01T00:00:00.000Z' });
    const state = { outbox: [stale('deleted', 'gone'), stale('current', 'old-1'), stale('current', 'old-2'), { id: 'replay', kind: 'replay-evidence' }] };
    refreshScreenshotOutboxFromData(state, {
      matches: [{ id: 'current', map: 'Ascent' }],
      playerStats: ['One', 'Two', 'Three', 'Four', 'Five'].map((player, index) => ({ id: `s${index}`, matchId: 'current', player, screenshotMetrics: { schemaVersion: 1 } })),
    }, '2026-10-14T12:00:00.000Z');
    expect(state.outbox).toHaveLength(2);
    const refreshed = state.outbox.find((item: any) => item.kind === 'screenshot-summary') as any;
    expect(refreshed.summary.playerStats).toHaveLength(5);
    expect(state.outbox.some((item: any) => item.matchId === 'deleted')).toBe(false);
    expect(state.outbox.some((item: any) => item.id === 'replay')).toBe(true);
  });
});
