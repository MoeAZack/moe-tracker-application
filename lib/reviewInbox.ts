// One list of everything waiting for a coach, whatever the source: captures,
// replays, duplicate copies, rounds an automatic save deferred, and coaching
// findings. Each item says where it is resolved; nothing here decides for the
// coach.

export type InboxTarget =
  | { surface: 'capture' }
  | { surface: 'replays' }
  | { surface: 'match'; matchId: string; roundNo?: number }
  | { surface: 'coaching' };

export interface InboxItem {
  id: string;
  kind: 'capture' | 'replay' | 'duplicate' | 'rounds' | 'finding';
  title: string;
  detail: string;
  target: InboxTarget;
}

const matchLabel = (match: any) => [match?.opponent || 'Unknown opponent', match?.map, match?.date].filter(Boolean).join(' · ');

export function buildReviewInbox(data: any, pending: { captures?: number; replays?: number } = {}): InboxItem[] {
  const items: InboxItem[] = [];
  const matches: any[] = Array.isArray(data?.matches) ? data.matches : [];
  const rounds: any[] = Array.isArray(data?.rounds) ? data.rounds : [];
  if ((pending.captures || 0) > 0) items.push({ id: 'captures', kind: 'capture', title: `${pending.captures} capture${pending.captures === 1 ? '' : 's'} to review`, detail: 'Screenshot captures that could not be saved automatically.', target: { surface: 'capture' } });
  if ((pending.replays || 0) > 0) items.push({ id: 'replays', kind: 'replay', title: `${pending.replays} replay${pending.replays === 1 ? '' : 's'} to accept`, detail: 'Parsed replays waiting for a coach to accept them into a match.', target: { surface: 'replays' } });
  for (const match of matches) if (match?.duplicateReview?.status === 'quarantined') items.push({
    id: `duplicate:${match.id}`, kind: 'duplicate', title: matchLabel(match), detail: 'Possible copy of a saved game. Keep both or discard this copy; it is left out of stats until then.', target: { surface: 'match', matchId: match.id },
  });
  for (const match of matches) {
    const deferred: number[] = Array.isArray(match?.automation?.roundsNeedingReview) ? match.automation.roundsNeedingReview : [];
    const open = deferred.filter(roundNo => rounds.some(round => round.matchId === match.id && Number(round.roundNo) === roundNo && round.screenshotEvidence?.reviewStatus !== 'confirmed'));
    if (open.length && match?.duplicateReview?.status !== 'quarantined') items.push({
      id: `rounds:${match.id}`, kind: 'rounds', title: matchLabel(match), detail: `Round${open.length === 1 ? '' : 's'} ${open.join(', ')} need${open.length === 1 ? 's' : ''} review before ${open.length === 1 ? 'its' : 'their'} detail counts.`, target: { surface: 'match', matchId: match.id, roundNo: open[0] },
    });
  }
  const findings = (Array.isArray(data?.coachingSignals) ? data.coachingSignals : []).filter((signal: any) => signal?.status === 'new' || signal?.status === 'needs-evidence');
  if (findings.length) items.push({ id: 'findings', kind: 'finding', title: `${findings.length} coaching finding${findings.length === 1 ? '' : 's'} to triage`, detail: 'New findings, or findings waiting for more evidence, in Coach Workspace.', target: { surface: 'coaching' } });
  return items;
}

export interface InboxGroup {
  id: string;
  title: string;
  detail: string;
  items: InboxItem[];
}

const GROUP_TITLES: Partial<Record<InboxItem['kind'], (count: number) => [string, string]>> = {
  duplicate: count => [`${count} possible duplicate copies`, 'Each is left out of stats until you keep both or discard the copy.'],
  rounds: count => [`${count} matches with rounds to review`, 'Rounds an automatic save could not settle. Their detail counts once reviewed.'],
};

/**
 * The inbox as the coach sees it: per-match items of the same kind collapse
 * into one group, so a busy scrim day reads as a few things to do rather than
 * a long list. A kind with one item stays a single entry.
 */
export function groupReviewInbox(items: InboxItem[]): InboxGroup[] {
  const groups: InboxGroup[] = [];
  const byKind = new Map<InboxItem['kind'], InboxGroup>();
  for (const item of items) {
    const sameKind = items.filter(other => other.kind === item.kind);
    const title = GROUP_TITLES[item.kind];
    if (sameKind.length < 2 || !title) { groups.push({ id: item.id, title: item.title, detail: item.detail, items: [item] }); continue; }
    const existing = byKind.get(item.kind);
    if (existing) { existing.items.push(item); continue; }
    const [groupTitle, detail] = title(sameKind.length);
    const group = { id: `group:${item.kind}`, title: groupTitle, detail, items: [item] };
    byKind.set(item.kind, group);
    groups.push(group);
  }
  return groups;
}
