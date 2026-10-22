'use strict';

const SOURCES = new Set(['screenshot', 'replay', 'youtube-vod', 'local-vod']);
const STATUSES = new Set(['queued', 'running', 'paused', 'ready', 'completed', 'failed', 'cancelled']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const sourceAliases = { youtube: 'youtube-vod', 'local-file': 'local-vod' };
const clamp = value => value === null || value === undefined ? null : Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const source = value => sourceAliases[String(value || '')] || String(value || '');

function createIngestionJob(input, now = new Date().toISOString()) {
  const normalizedSource = source(input.source);
  if (!SOURCES.has(normalizedSource)) throw new Error(`Unknown ingestion source: ${input.source}`);
  return {
    schema: 'moetracker.ingestion-job/v1', id: String(input.id), source: normalizedSource,
    status: 'queued', stage: 'queued', percent: 0, message: 'Waiting to start.',
    checkpoint: null, retainedSource: input.retainedSource === true, resumable: false,
    createdAt: now, updatedAt: now,
    ...(input.kind ? { kind: String(input.kind) } : {}),
    ...(input.expectedGames ? { expectedGames: Number(input.expectedGames) } : {}),
  };
}

function updateIngestionJob(current, patch, now = new Date().toISOString()) {
  const nextStatus = patch.status || current.status;
  if (!STATUSES.has(nextStatus)) throw new Error(`Unknown ingestion status: ${nextStatus}`);
  if (current.status === 'completed' && nextStatus !== 'completed') throw new Error('A completed ingestion job is immutable.');
  const retainedSource = patch.retainedSource ?? current.retainedSource ?? false;
  const checkpoint = patch.checkpoint === undefined ? current.checkpoint ?? null : patch.checkpoint;
  const resumable = patch.resumable === undefined
    ? Boolean(retainedSource && checkpoint && !TERMINAL.has(nextStatus))
    : patch.resumable === true && retainedSource;
  return {
    ...current, ...patch, source: source(patch.source || current.source), status: nextStatus,
    percent: nextStatus === 'completed' ? 100 : clamp(patch.percent === undefined ? current.percent : patch.percent),
    retainedSource, checkpoint, resumable, updatedAt: now,
  };
}

function recoverInterruptedJobs(jobs, now = new Date().toISOString()) {
  return (jobs || []).map(job => {
    const normalized = { ...job, schema: 'moetracker.ingestion-job/v1', source: source(job.source) };
    if (!['working', 'running'].includes(job.status)) return normalized;
    return updateIngestionJob(normalized, {
      status: normalized.retainedSource ? 'paused' : 'failed',
      stage: normalized.retainedSource ? 'interrupted' : 'source-unavailable',
      message: normalized.retainedSource ? 'Interrupted safely. Resume from the last retained checkpoint.' : 'Interrupted before a restartable source was retained.',
      resumable: Boolean(normalized.retainedSource),
    }, now);
  });
}

// The startup sweep keeps a VOD work folder only for these jobs (see
// sweepOrphanedVodDirectories); their records must survive a history clear.
const keepsRetainedWork = job => job?.resumable === true || ['running', 'paused', 'ready', 'queued'].includes(job?.status);
const isActive = job => ['running', 'queued'].includes(job?.status);

/**
 * Clears jobs from the history list (all, or the given ids). A finished job
 * with nothing retained is dropped. A job that still holds a retained video
 * is only hidden, so its record keeps the video from the startup sweep.
 * Running and queued jobs are never touched.
 */
function clearIngestionHistory(jobs, ids = null, now = new Date().toISOString()) {
  const wanted = ids ? new Set(ids.map(String)) : null;
  let removed = 0; let hidden = 0;
  const next = [];
  for (const job of jobs || []) {
    if ((wanted && !wanted.has(String(job.id))) || isActive(job) || job.clearedAt) { next.push(job); continue; }
    if (keepsRetainedWork(job)) { next.push({ ...job, clearedAt: now }); hidden += 1; } else removed += 1;
  }
  return { jobs: next, removed, hidden };
}

const listedIngestionJobs = jobs => (jobs || []).filter(job => !job.clearedAt);

function publicIngestionJob(job) {
  const { sourcePath: _sourcePath, checkpointFile: _checkpointFile, ...safe } = job;
  return safe;
}

module.exports = { SOURCES, STATUSES, createIngestionJob, updateIngestionJob, recoverInterruptedJobs, publicIngestionJob, clearIngestionHistory, listedIngestionJobs };

