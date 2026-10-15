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
});
