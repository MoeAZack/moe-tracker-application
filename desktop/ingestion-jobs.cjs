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

function publicIngestionJob(job) {
  const { sourcePath: _sourcePath, checkpointFile: _checkpointFile, ...safe } = job;
  return safe;
}

module.exports = { SOURCES, STATUSES, createIngestionJob, updateIngestionJob, recoverInterruptedJobs, publicIngestionJob };

