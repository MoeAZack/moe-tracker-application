import { describe, expect, it } from 'vitest';
import { applyPortablePackage, createPortablePackage, previewPortablePackage, validatePortablePackage } from '../lib/portablePackage';
import { createSeed } from '../lib/seed';

function source() {
  const db: any = createSeed();
  db.authKeys = [{ id: 'secret', keyHash: 'must-not-export' }]; db.allowedUsers = [{ email: 'private@example.com' }];
  db.matches = [{ id: 'match-1', date: '2026-10-13', opponent: 'Rivals', map: 'Haven' }];
  db.playerStats = [{ id: 'stat-1', matchId: 'match-1', playerId: 'p1', kills: 20 }];
  db.engineAdapters = { replay: { 'match-1': { matchId: 'match-1', status: 'accepted', provenance: { replaySha256: 'a'.repeat(64) } }, draft: { matchId: 'draft', status: 'review-required' } } };
  return db;
}

describe('portable MoeTracker packages', () => {
  it('exports integrity-bound team data without authentication secrets', () => {
    const pkg = createPortablePackage(source(), 'desktop-one', '2026-10-13T09:00:00.000Z');
    expect(validatePortablePackage(pkg)).toBe(pkg);
    expect(pkg.manifest).toMatchObject({ sourceDeviceId: 'desktop-one', acceptedReplayCount: 1 });
    expect(pkg.payload.collections.matches).toHaveLength(1); expect(Object.keys(pkg.payload.acceptedReplays)).toEqual(['match-1']);
    expect(JSON.stringify(pkg)).not.toContain('must-not-export'); expect(JSON.stringify(pkg)).not.toContain('private@example.com');
  });

  it('detects tampering and previews additions, duplicates, and conflicts before applying', () => {
    const pkg = createPortablePackage(source(), 'desktop-one'); const local: any = createSeed();
    local.matches = [{ id: 'match-1', date: '2026-10-12', opponent: 'Different', map: 'Ascent' }];
    const preview = previewPortablePackage(local, pkg); expect(preview.collections.matches).toMatchObject({ additions: 0, duplicates: 0, conflicts: 1 }); expect(preview.collections.playerStats.additions).toBe(1); expect(preview.safeToApply).toBe(false);
    const result = applyPortablePackage(local, pkg); expect(result.applied.collections.matches).toBe(0); expect(result.applied.collections.playerStats).toBe(1); expect(local.matches[0].opponent).toBe('Different'); expect(local.engineAdapters.replay['match-1'].status).toBe('accepted');
    const tampered: any = structuredClone(pkg); tampered.payload.collections.matches[0].map = 'Bind'; expect(() => validatePortablePackage(tampered)).toThrow(/integrity/i);
  });

  it('creates a one-player transfer without unrelated player evidence', () => {
    const db = source(); db.rosterPlayers = [{ id: 'p1', displayName: 'One' }, { id: 'p2', displayName: 'Two' }]; db.playerStats.push({ id: 'stat-2', matchId: 'match-2', playerId: 'p2', kills: 10 }); db.matches.push({ id: 'match-2', date: '2026-10-12' });
    const pkg = createPortablePackage(db, 'desktop-one', '2026-10-13T09:00:00.000Z', { scope: 'player', id: 'p1' });
    expect(pkg.manifest).toMatchObject({ scope: 'player', selectionId: 'p1' }); expect(pkg.payload.collections.rosterPlayers.map((row: any) => row.id)).toEqual(['p1']); expect(pkg.payload.collections.playerStats.map((row: any) => row.id)).toEqual(['stat-1']); expect(pkg.payload.collections.matches.map((row: any) => row.id)).toEqual(['match-1']);
  });
});
