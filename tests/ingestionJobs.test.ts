import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createIngestionJob, updateIngestionJob, recoverInterruptedJobs, publicIngestionJob } = require('../desktop/ingestion-jobs.cjs');

describe('unified ingestion jobs', () => {
  it.each(['screenshot', 'replay', 'youtube-vod', 'local-vod'])('uses one job contract for %s', source => {
    expect(createIngestionJob({ id: source, source }, '2026-10-20T10:00:00.000Z')).toMatchObject({ schema: 'moetracker.ingestion-job/v1', source, status: 'queued', percent: 0 });
  });

  it('normalizes legacy VOD source names and clamps progress', () => {
    const job = createIngestionJob({ id: 'v1', source: 'youtube' });
    expect(updateIngestionJob(job, { status: 'running', stage: 'download', percent: 109 })).toMatchObject({ source: 'youtube-vod', status: 'running', percent: 100 });
  });

  it('resumes only when both source and checkpoint are retained', () => {
    const job = createIngestionJob({ id: 'v1', source: 'local-vod', retainedSource: true });
    expect(updateIngestionJob(job, { status: 'paused', checkpoint: { frame: 25 } }).resumable).toBe(true);
    expect(updateIngestionJob(createIngestionJob({ id: 's1', source: 'screenshot' }), { status: 'paused', checkpoint: { stage: 'ocr' } }).resumable).toBe(false);
  });

  it('recovers interrupted retained work and fails closed without a retained source', () => {
    const retained = { ...createIngestionJob({ id: 'a', source: 'local-vod', retainedSource: true }), status: 'running', checkpoint: { frame: 8 } };
    const transient = { ...createIngestionJob({ id: 'b', source: 'screenshot' }), status: 'running' };
    expect(recoverInterruptedJobs([retained, transient])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a', status: 'paused', resumable: true }),
      expect.objectContaining({ id: 'b', status: 'failed', resumable: false }),
    ]));
  });

  it('redacts local paths from renderer-visible jobs and freezes completed jobs', () => {
    const completed = updateIngestionJob({ ...createIngestionJob({ id: 'x', source: 'replay' }), sourcePath: 'C:/secret/replay' }, { status: 'completed' });
    expect(publicIngestionJob(completed)).not.toHaveProperty('sourcePath');
    expect(() => updateIngestionJob(completed, { status: 'running' })).toThrow(/immutable/);
  });
});
