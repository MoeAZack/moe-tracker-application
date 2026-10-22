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

describe('clearing the ingestion job history', () => {
  const { clearIngestionHistory, listedIngestionJobs } = require('../desktop/ingestion-jobs.cjs');
  const { sweepOrphanedVodDirectories } = require('../desktop/vod-timeline-analyzer.cjs');
  const now = '2026-10-22T23:00:00.000Z';
  const job = (id: string, patch: Record<string, unknown>) => ({ ...createIngestionJob({ id, source: 'local-vod', retainedSource: true }), ...patch });
  const history = () => [
    job('done', { status: 'completed', resumable: false, retainedSource: false }),
    job('failed', { status: 'failed', resumable: false, retainedSource: false }),
    job('paused', { status: 'paused', resumable: true, cacheId: '11111111-1111-1111-1111-111111111111' }),
    job('probe', { status: 'ready', resumable: true, cacheId: '22222222-2222-2222-2222-222222222222' }),
    job('running', { status: 'running', resumable: false }),
  ];

  it('drops finished entries, hides ones that hold a retained video, and leaves running work alone', () => {
    const result = clearIngestionHistory(history(), null, now);
    expect(result).toMatchObject({ removed: 2, hidden: 2 });
    expect(result.jobs.map((item: any) => [item.id, item.clearedAt ?? null])).toEqual([['paused', now], ['probe', now], ['running', null]]);
    expect(listedIngestionJobs(result.jobs).map((item: any) => item.id)).toEqual(['running']);
    // A hidden paused job keeps its record, so it can still be resumed by id.
    expect(result.jobs.find((item: any) => item.id === 'paused')).toMatchObject({ status: 'paused', resumable: true });
  });

  it('clears only the chosen entries', () => {
    const result = clearIngestionHistory(history(), ['failed', 'running'], now);
    expect(result).toMatchObject({ removed: 1, hidden: 0 });
    expect(result.jobs.map((item: any) => item.id)).toEqual(['done', 'paused', 'probe', 'running']);
  });

  it('keeps every retained video folder through the next startup sweep', async () => {
    const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vod-sweep-'));
    try {
      const folders = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'].map(id => path.join(root, `source-${id}`));
      for (const folder of folders) { await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'video.mp4'), 'x'); }
      await sweepOrphanedVodDirectories(root, clearIngestionHistory(history(), null, now).jobs);
      for (const folder of folders) await expect(fs.stat(path.join(folder, 'video.mp4'))).resolves.toBeTruthy();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
