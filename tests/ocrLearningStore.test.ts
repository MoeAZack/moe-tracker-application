import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe('OCR learning controls', () => {
  it('pauses training without deleting labels and can reset every local label', async () => {
    vi.resetModules();
    const store = await import('../src/utils/ocrLearningStore');
    const sample = (id: string, captureId: string) => ({
      id, captureId, matchId: captureId, playerId: 'p1', field: 'name' as const,
      predicted: 'be11atrix', corrected: 'bellatrix', modelVersion: 'local-v1',
      recordedAt: `2026-10-20T10:00:0${id}.000Z`, sourceRegion: 'player.0.name',
    });

    await store.recordOcrCorrections([sample('1', 'cap-1'), sample('2', 'cap-2')]);
    expect(await store.getOcrLearningState([{ id: 'p1', displayName: 'bellatrix' }])).toMatchObject({
      enabled: true,
      aliases: [{ observed: 'be11atrix', playerId: 'p1', confirmations: 2 }],
    });

    store.setOcrLearningEnabled(false);
    await store.recordOcrCorrections([sample('3', 'cap-3')]);
    const paused = await store.getOcrLearningState([{ id: 'p1', displayName: 'bellatrix' }]);
    expect(paused.enabled).toBe(false);
    expect(paused.corrections).toHaveLength(2);
    expect(paused.aliases).toEqual([]);
    expect(paused.model.rules).toEqual([]);

    await store.resetOcrLearning();
    expect((await store.getOcrLearningState([{ id: 'p1', displayName: 'bellatrix' }])).corrections).toEqual([]);
  });
});
