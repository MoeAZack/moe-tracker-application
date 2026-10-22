import { describe, expect, it } from 'vitest';
import { importRecoveredOcrLearning } from '../src/utils/ocrLearningStore';

function memoryStore(initial: Record<'corrections' | 'outcomes', string[]>, { failWrites = false } = {}) {
  const rows: Record<string, Map<string, any>> = { corrections: new Map(initial.corrections.map(id => [id, { id, existing: true }])), outcomes: new Map(initial.outcomes.map(id => [id, { id, existing: true }])) };
  return {
    rows,
    storedIds: async (name: 'corrections' | 'outcomes') => new Set(rows[name].keys()),
    putMany: async (name: 'corrections' | 'outcomes', list: any[]) => { if (failWrites) return false; for (const row of list) rows[name].set(row.id, row); return true; },
  };
}

function bridge(recovered: any) {
  const confirmed: number[][] = [];
  return { confirmed, takeRecoveredOcrLearning: async () => recovered, confirmRecoveredOcrLearning: async (ports: number[]) => { confirmed.push(ports); return { recorded: ports.length }; } };
}

describe('recovered OCR learning import', () => {
  it('adds only rows this launch lacks, then confirms the old addresses', async () => {
    const store = memoryStore({ corrections: ['c1'], outcomes: [] });
    const desktop = bridge({ ports: [57856, 59515], corrections: [{ id: 'c1', recovered: true }, { id: 'c2' }], outcomes: [{ id: 'o1' }] });
    expect(await importRecoveredOcrLearning(desktop, store as any)).toEqual({ corrections: 1, outcomes: 1 });
    expect(store.rows.corrections.get('c1')).toEqual({ id: 'c1', existing: true });
    expect([...store.rows.corrections.keys()]).toEqual(['c1', 'c2']);
    expect([...store.rows.outcomes.keys()]).toEqual(['o1']);
    expect(desktop.confirmed).toEqual([[57856, 59515]]);
  });

  it('does not confirm when the rows could not be saved, so the next launch retries', async () => {
    const store = memoryStore({ corrections: [], outcomes: [] }, { failWrites: true });
    const desktop = bridge({ ports: [57856], corrections: [{ id: 'c2' }], outcomes: [] });
    await expect(importRecoveredOcrLearning(desktop, store as any)).rejects.toThrow(/could not be saved/);
    expect(desktop.confirmed).toEqual([]);
  });

  it('does nothing outside the desktop app or when there is nothing to recover', async () => {
    const store = memoryStore({ corrections: [], outcomes: [] });
    expect(await importRecoveredOcrLearning(undefined, store as any)).toBeNull();
    const desktop = bridge({ ports: [], corrections: [], outcomes: [] });
    expect(await importRecoveredOcrLearning(desktop, store as any)).toBeNull();
    expect(desktop.confirmed).toEqual([]);
  });
});
