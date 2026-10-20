import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('closed-loop coaching UI contract', () => {
  it('exposes canonical goal evidence and distinct linked review events', () => {
    const source = fs.readFileSync('src/components/CalendarGoals.tsx', 'utf8');
    for (const label of ['Linked round (optional)', 'Evidence clip (optional)', 'Coaching loop', 'Linked coaching pair', 'Team Talk and Debrief stay separate events']) expect(source).toContain(label);
    expect(source).toContain('ownerPlayerId');
    expect(source).toContain('linkedReviewEventId');
  });
});
