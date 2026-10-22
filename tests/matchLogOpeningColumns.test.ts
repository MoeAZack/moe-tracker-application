import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('match log opening-duel columns', () => {
  it('shows first deaths in the scoreboard and separates per-round first kill and first death', () => {
    const source = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
    expect(source).toContain('First bloods');
    expect(source).toContain('First deaths');
    expect(source).toContain('{ps.fd ??');
    expect(source).toContain('First kill');
    expect(source).toContain('First death');
    expect(source).toContain('r.firstDeathBy');
  });

  it('renders plant and discipline as three-state evidence instead of treating missing as No', () => {
    // The round sheet editor lives in its own component; the round log stays in Match Review.
    const source = ['src/components/MatchLogRounds.tsx', 'src/components/RoundSheetEditor.tsx'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).toContain("roundFlag(r.plant) === true ? 'Yes' : roundFlag(r.plant) === false ? 'No' : '—'");
    expect(source).toContain('Round ${r.roundNo} plant status');
    expect(source).toContain('Round ${r.roundNo} discipline status');
    expect(source).not.toContain("{r.plant ? 'Yes' : 'No'}");
  });
});
