import { describe, expect, it } from 'vitest';
import { clearableJob, ingestionClearMessage } from '../src/utils/ingestionHistory';

describe('ingestion history clear wording', () => {
  it('says matches, evidence and videos stay, and warns when paused imports can no longer be resumed', () => {
    expect(ingestionClearMessage([{ status: 'failed' }, { status: 'completed' }])).toBe('Clear 2 entries from the job history? Imported matches, their evidence and your videos are not touched.');
    const paused = ingestionClearMessage([{ status: 'paused', resumable: true }, { status: 'ready', resumable: true }, { status: 'failed' }, { status: 'running' }]);
    expect(paused).toContain('Clear 3 entries');
    expect(paused).toContain('2 paused imports keep the video copy saved on this PC, but they can no longer be resumed from this list.');
    expect(ingestionClearMessage([{ status: 'paused', resumable: true }])).toContain('One paused import keeps');
  });

  it('never offers to clear running or queued work', () => {
    expect(['running', 'queued', 'paused', 'failed'].map(status => clearableJob({ status }))).toEqual([false, false, true, true]);
  });
});
