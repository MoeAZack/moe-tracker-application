import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReviewInbox } from '../lib/reviewInbox';
import ReviewInbox from '../src/components/ReviewInbox';

const data: any = {
  matches: [
    { id: 'm1', opponent: 'PYO', map: 'Ascent', date: '2026-10-20' },
    { id: 'm2', opponent: 'PYO', map: 'Ascent', date: '2026-10-20', duplicateReview: { status: 'quarantined' } },
    { id: 'm3', opponent: 'Nova', map: 'Lotus', date: '2026-10-21', automation: { roundsNeedingReview: [4, 9] } },
    { id: 'm4', opponent: 'Kept', map: 'Bind', date: '2026-10-21', duplicateReview: { status: 'kept-distinct' } },
  ],
  rounds: [
    { matchId: 'm3', roundNo: 4, screenshotEvidence: { reviewStatus: 'review-required' } },
    { matchId: 'm3', roundNo: 9, screenshotEvidence: { reviewStatus: 'confirmed' } },
  ],
  coachingSignals: [{ status: 'new' }, { status: 'needs-evidence' }, { status: 'accepted' }],
};

describe('review inbox', () => {
  it('lists every pending item from every source with where it is resolved', () => {
    const items = buildReviewInbox(data, { captures: 2, replays: 1 });
    expect(items.map(item => item.id)).toEqual(['captures', 'replays', 'duplicate:m2', 'rounds:m3', 'findings']);
    expect(items.find(item => item.id === 'duplicate:m2')!.target).toEqual({ surface: 'match', matchId: 'm2' });
    // Round 9 was confirmed since the save, so only round 4 is still open.
    expect(items.find(item => item.id === 'rounds:m3')).toMatchObject({ detail: expect.stringContaining('Round 4 needs review'), target: { surface: 'match', matchId: 'm3', roundNo: 4 } });
    expect(items.find(item => item.id === 'findings')!.title).toBe('2 coaching findings to triage');
  });

  it('is empty when nothing waits, and never invents counts', () => {
    expect(buildReviewInbox({ matches: [{ id: 'm1' }] }, {})).toEqual([]);
    expect(buildReviewInbox({}, { captures: 0, replays: 0 })).toEqual([]);
  });

  it('renders the items, or says nothing is waiting', () => {
    const html = renderToStaticMarkup(<ReviewInbox data={data} desktopMode={false} onOpen={() => {}} />);
    expect(html).toContain('Inbox'); expect(html).toContain('Possible copy of a saved game'); expect(html).toContain('3 waiting');
    expect(renderToStaticMarkup(<ReviewInbox data={{ matches: [] } as any} desktopMode={false} onOpen={() => {}} />)).toContain('Nothing waiting for review');
  });
});
