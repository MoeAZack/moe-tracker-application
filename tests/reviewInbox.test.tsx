import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReviewInbox, groupReviewInbox } from '../lib/reviewInbox';
import { countActiveFilters } from '../src/components/CoachWorkflow';
import ReviewInbox from '../src/components/ReviewInbox';

const data: any = {
  matches: [
    { id: 'm1', opponent: 'PYO', map: 'Ascent', date: '2026-10-20' },
    { id: 'm2', opponent: 'PYO', map: 'Ascent', date: '2026-10-20', duplicateReview: { status: 'quarantined' } },
    { id: 'm3', opponent: 'Nova', map: 'Lotus', date: '2026-10-21', automation: { roundsNeedingReview: [4, 9] } },
    { id: 'm5', opponent: 'Copy', map: 'Lotus', date: '2026-10-21', automation: { roundsNeedingReview: [3] }, duplicateReview: { status: 'quarantined' } },
    { id: 'm4', opponent: 'Kept', map: 'Bind', date: '2026-10-21', duplicateReview: { status: 'kept-distinct' } },
  ],
  rounds: [
    { matchId: 'm3', roundNo: 4, screenshotEvidence: { reviewStatus: 'review-required' } },
    { matchId: 'm5', roundNo: 3, screenshotEvidence: { reviewStatus: 'review-required' } },
    { matchId: 'm3', roundNo: 9, screenshotEvidence: { reviewStatus: 'confirmed' } },
  ],
  coachingSignals: [{ status: 'new' }, { status: 'needs-evidence' }, { status: 'accepted' }],
};

describe('review inbox', () => {
  it('lists every pending item from every source with where it is resolved', () => {
    const items = buildReviewInbox(data, { captures: 2, replays: 1 });
    expect(items.map(item => item.id)).toEqual(['captures', 'replays', 'duplicate:m2', 'duplicate:m5', 'rounds:m3', 'findings']);
    // A quarantined copy is resolved by its duplicate decision; its deferred rounds are not listed separately.
    expect(items.some(item => item.id === 'rounds:m5')).toBe(false);
    expect(items.find(item => item.id === 'duplicate:m2')!.target).toEqual({ surface: 'match', matchId: 'm2' });
    // Round 9 was confirmed since the save, so only round 4 is still open.
    expect(items.find(item => item.id === 'rounds:m3')).toMatchObject({ detail: expect.stringContaining('Round 4 needs review'), target: { surface: 'match', matchId: 'm3', roundNo: 4 } });
    expect(items.find(item => item.id === 'findings')!.title).toBe('2 coaching findings to triage');
  });

  it('is empty when nothing waits, and never invents counts', () => {
    expect(buildReviewInbox({ matches: [{ id: 'm1' }] }, {})).toEqual([]);
    expect(buildReviewInbox({}, { captures: 0, replays: 0 })).toEqual([]);
  });

  it('collapses same-kind match items into one group and keeps single items as they are', () => {
    const groups = groupReviewInbox(buildReviewInbox(data, { captures: 2, replays: 1 }));
    expect(groups.map(group => group.id)).toEqual(['captures', 'replays', 'group:duplicate', 'rounds:m3', 'findings']);
    const copies = groups.find(group => group.id === 'group:duplicate')!;
    expect(copies.title).toBe('2 possible duplicate copies');
    expect(copies.items.map(item => item.target)).toEqual([{ surface: 'match', matchId: 'm2' }, { surface: 'match', matchId: 'm5' }]);
    expect(groups.find(group => group.id === 'rounds:m3')!.items).toHaveLength(1);
  });

  it('counts the filters narrowing Coach Workspace, so a closed Filter button still says so', () => {
    expect(countActiveFilters({ blockId: null, map: null, source: null, confidence: null }, { side: '', player: '' })).toBe(0);
    expect(countActiveFilters({ blockId: null, map: 'Haven', source: null, confidence: 'low' }, { side: 'ATT', player: '' })).toBe(3);
  });

  it('renders the groups, each match still one click away, or says nothing is waiting', () => {
    const html = renderToStaticMarkup(<ReviewInbox data={data} desktopMode={false} onOpen={() => {}} />);
    expect(html).toContain('Inbox'); expect(html).toContain('2 possible duplicate copies'); expect(html).toContain('Possible copy of a saved game'); expect(html).toContain('3 to do');
    expect(html).toContain('<details');
    expect(renderToStaticMarkup(<ReviewInbox data={{ matches: [] } as any} desktopMode={false} onOpen={() => {}} />)).toContain('Nothing waiting for review');
  });
});
