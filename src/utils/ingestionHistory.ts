type HistoryJob = { status: string; resumable?: boolean };

const keepsRetainedVideo = (job: HistoryJob) => job.resumable === true || ['paused', 'ready'].includes(job.status);
export const clearableJob = (job: HistoryJob) => !['running', 'queued'].includes(job.status);

/** What clearing these history entries does, said before the coach confirms. */
export function ingestionClearMessage(jobs: readonly HistoryJob[]) {
  const clearable = jobs.filter(clearableJob);
  const paused = clearable.filter(keepsRetainedVideo).length;
  const count = clearable.length;
  const base = `Clear ${count === 1 ? 'this entry' : `${count} entries`} from the job history? Imported matches, their evidence and your videos are not touched.`;
  return paused
    ? `${base} ${paused === 1 ? 'One paused import keeps' : `${paused} paused imports keep`} the video copy saved on this PC, but ${paused === 1 ? 'it' : 'they'} can no longer be resumed from this list.`
    : base;
}
