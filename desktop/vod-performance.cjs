// VOD import speed settings. Defaults stay safe on weak PCs: hardware decode is
// off, and "auto" OCR threads use at most four cores and only what free memory
// allows. One thread is exactly the behaviour before this setting existed.
const MAX_OCR_WORKERS = 8;
const AUTO_OCR_WORKER_LIMIT = 4;
// A tesseract.js worker with the English model holds roughly 150-250 MB.
const OCR_WORKER_BYTES = 300 * 1024 * 1024;
const MEMORY_RESERVE_BYTES = 1024 * 1024 * 1024;

function normalizeVodPerformance(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const workers = Number(value.ocrWorkers);
  const ocrWorkers = value.ocrWorkers === 'auto' || value.ocrWorkers == null ? 'auto' : Number.isInteger(workers) && workers >= 1 && workers <= MAX_OCR_WORKERS ? workers : 'auto';
  return { ocrWorkers, hardwareDecode: value.hardwareDecode === true };
}

// How many OCR workers to start for one game. The candidate frames are already
// in memory when OCR starts, so the budget is free memory minus those frames
// minus a reserve for the app itself.
function resolveOcrWorkers(setting, { cpus, freeBytes, frameBytes = 0 }) {
  const cores = Math.max(1, Number(cpus) || 1);
  const requested = setting === 'auto' || setting == null ? Math.min(Math.max(1, cores - 1), AUTO_OCR_WORKER_LIMIT) : Math.min(Math.max(1, Math.floor(Number(setting)) || 1), MAX_OCR_WORKERS, cores);
  const budget = Number(freeBytes) - Number(frameBytes || 0) - MEMORY_RESERVE_BYTES;
  const memoryLimit = Number.isFinite(budget) ? Math.max(1, Math.floor(budget / OCR_WORKER_BYTES)) : 1;
  return Math.max(1, Math.min(requested, memoryLimit));
}

function regionFilter(spec) { return `fps=${spec.fps},${spec.crop},scale=${spec.width}:${spec.height}:flags=fast_bilinear,format=gray`; }

function sampledRange(range = {}, durationSeconds) {
  const startSeconds = Math.max(0, Number(range.startMs || 0) / 1000);
  const endSeconds = Number(range.endMs) > Number(range.startMs || 0) ? Number(range.endMs) / 1000 : null;
  return { startSeconds, endSeconds, sampledDuration: endSeconds ? endSeconds - startSeconds : durationSeconds };
}

// One region per decode: the original path, kept as the fallback.
function regionDecodeArgs(file, spec, range) {
  const { startSeconds, endSeconds, sampledDuration } = range;
  return ['-hide_banner', '-loglevel', 'error', ...(startSeconds ? ['-ss', String(startSeconds)] : []), '-i', file, ...(endSeconds ? ['-t', String(sampledDuration)] : []), '-an', '-vf', regionFilter(spec), '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
}

// One decode feeding every region. Each branch runs the same filter chain the
// per-region decode runs, so the frames are the same bytes. Region i is written
// to file descriptor 3 + i.
function combinedDecodeArgs(file, specs, range, { hardwareDecode = false } = {}) {
  const { startSeconds, endSeconds, sampledDuration } = range;
  const graph = `[0:v]split=${specs.length}${specs.map((_, index) => `[v${index}]`).join('')};${specs.map((spec, index) => `[v${index}]${regionFilter(spec)}[o${index}]`).join(';')}`;
  return ['-hide_banner', '-loglevel', 'error', ...(hardwareDecode ? ['-hwaccel', 'auto'] : []), ...(startSeconds ? ['-ss', String(startSeconds)] : []), '-i', file, '-filter_complex', graph,
    ...specs.flatMap((_, index) => ['-map', `[o${index}]`, ...(endSeconds ? ['-t', String(sampledDuration)] : []), '-an', '-f', 'rawvideo', '-pix_fmt', 'gray', `pipe:${3 + index}`])];
}

module.exports = { MAX_OCR_WORKERS, OCR_WORKER_BYTES, MEMORY_RESERVE_BYTES, normalizeVodPerformance, resolveOcrWorkers, regionFilter, sampledRange, regionDecodeArgs, combinedDecodeArgs };
