import { describe, expect, it } from 'vitest';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import { vodSubmissionSchema } from '../schemas';
import { MAX_PUBLIC_OBSERVATIONS, publicTimelineEvidence, submissionError } from '../src/utils/vodImportRunner';

const { aggregateVideoEvidence } = evidenceModule;

// What the import posts for a coach VOD game with typed names: the analyzer's evidence as made today
// (a TAB board read, K/D/A from it plus the kill feed, a HUD read every few seconds of a long game).
describe('a VOD game the analyzer read in full is accepted by the server', () => {
  const players = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'].map(name => ({ name, team: 'ours' as const }));
  const evidence = () => {
    const rows = players.map((player, row) => ({ row, name: player.name, kills: 3, deaths: 2, assists: 1 }));
    const hud = Array.from({ length: 2600 }, (_, index) => ({ timestampMs: 1000 + index * 1000, text: `${Math.min(12, Math.floor(index / 200))}  1:${String(40 - (index % 40)).padStart(2, '0')}  ${Math.min(12, Math.floor(index / 210))}` }));
    const result = aggregateVideoEvidence({ players, durationMs: 2_700_000, tabBoards: [{ timestampMs: 600_000, rows }], killFeedSnapshots: [{ timestampMs: 900_000, text: 'Ana Vandal Zed' }], roundStateSnapshots: hud });
    return { ...result, source: { kind: 'local-file', videoId: null, sha256: 'a'.repeat(64), width: 1280, height: 720, durationMs: 2_700_000, analyzedAt: '2026-10-23T12:00:00.000Z' } };
  };
  const body = (timelineEvidence: unknown) => ({ vodUrl: `moetracker-local://sha256/${'b'.repeat(64)}`, imageSha256: 'c'.repeat(64), coachTeamEvidence: true, addObservedPlayers: true, date: '2026-10-23', map: 'Haven', opponent: null, ourScore: null, theirScore: null, players: players.map(player => ({ observedName: player.name, agent: null, kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null })), timelineEvidence });

  it('keeps the TAB board, assists and source, and fits the observations under the cap', () => {
    const raw = evidence();
    expect(raw.tabBoard).toBeDefined();
    expect(raw.observations.length).toBeGreaterThan(MAX_PUBLIC_OBSERVATIONS);
    const saved = publicTimelineEvidence(raw);
    expect(saved.observations.length).toBeLessThanOrEqual(MAX_PUBLIC_OBSERVATIONS);
    expect(saved.observations.some((item: any) => item.kind === 'elimination')).toBe(true);
    expect(saved.observations.filter((item: any) => item.kind === 'round-state').at(-1).score).toEqual([12, 12]);
    expect(saved.observations.every((item: any) => !('rawText' in item))).toBe(true);
    const parsed = vodSubmissionSchema.safeParse(body(saved));
    expect(parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)).toEqual([]);
    expect(saved.playerMetrics.find((metric: any) => metric.playerName === 'Ana')).toMatchObject({ kills: 4, assists: 1, source: 'tab-board+kill-feed' });
  });

  it('takes a coach team VOD naming fewer than five, never a player VOD', () => {
    const three = { ...body(null), players: body(null).players.slice(0, 3) };
    expect(vodSubmissionSchema.safeParse(three).success).toBe(true);
    const player = { ...three, coachTeamEvidence: false };
    const refused = vodSubmissionSchema.safeParse(player);
    expect(refused.success).toBe(false);
    expect(refused.success ? null : refused.error.issues[0].path).toEqual(['players']);
  });

  it('shows which field the server refused', () => {
    expect(submissionError({ error: 'Invalid request payload.', details: ['map: Required', 'players: too many'] }, 0)).toBe('Invalid request payload. (map: Required; players: too many)');
    expect(submissionError({}, 1)).toBe('Game 2 could not be integrated.');
  });
});
