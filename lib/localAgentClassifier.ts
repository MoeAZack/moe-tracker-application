export interface AgentTemplateScore { name: string; score: number }

/** Chroma-tolerant portrait distance for row tint and brightness variations. */
export function agentPortraitDistance(actual: Uint8ClampedArray, expected: Uint8ClampedArray) {
  if (actual.length !== expected.length || actual.length < 4 || actual.length % 4 !== 0) return Number.POSITIVE_INFINITY;
  const luminance = (pixels: Uint8ClampedArray) => {
    const values = new Float64Array(pixels.length / 4); let sum = 0;
    for (let index = 0; index < values.length; index += 1) { const offset = index * 4; const value = (77 * pixels[offset] + 150 * pixels[offset + 1] + 29 * pixels[offset + 2]) / 256; values[index] = value; sum += value; }
    const mean = sum / values.length; let variance = 0; for (const value of values) variance += (value - mean) ** 2;
    return { values, mean, deviation: Math.max(8, Math.sqrt(variance / values.length)) };
  };
  const left = luminance(actual); const right = luminance(expected); let normalized = 0; let raw = 0;
  for (let index = 0; index < left.values.length; index += 1) {
    normalized += ((left.values[index] - left.mean) / left.deviation - (right.values[index] - right.mean) / right.deviation) ** 2;
    const offset = index * 4; raw += (actual[offset] - expected[offset]) ** 2 + (actual[offset + 1] - expected[offset + 1]) ** 2 + (actual[offset + 2] - expected[offset + 2]) ** 2;
  }
  return raw / (left.values.length * 3) * .35 + normalized / left.values.length * 2_500;
}

/**
 * Plain per-channel mean squared error. The final scoreboard portraits are
 * rendered over a sampled row tint, so the raw colour difference separates
 * look-alike portraits (Sova/Chamber, Cypher/Gekko) better than the
 * luminance-normalized distance; the labelled corpus regressed from 141 to
 * 130 of 150 agents when the scoreboard switched away from it.
 */
export function rawPortraitDistance(actual: Uint8ClampedArray, expected: Uint8ClampedArray) {
  if (actual.length !== expected.length || actual.length < 4 || actual.length % 4 !== 0) return Number.POSITIVE_INFINITY;
  let error = 0;
  for (let index = 0; index < actual.length; index += 4) error += (actual[index] - expected[index]) ** 2 + (actual[index + 1] - expected[index + 1]) ** 2 + (actual[index + 2] - expected[index + 2]) ** 2;
  return error / (actual.length / 4 * 3);
}

export function chooseAgentMatch(scores: readonly AgentTemplateScore[]): string | null {
  const ranked = [...scores].filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score);
  if (ranked.length < 2 || ranked[0].score > 9_500) return null;
  return ranked[1].score / Math.max(1, ranked[0].score) >= 1.04 ? ranked[0].name : null;
}

const loadImage = async (url: string) => {
  const image = new Image(); image.src = url; await image.decode(); return image;
};

let templatePromise: Promise<Array<{ name: string; file: string; image: HTMLImageElement }>> | null = null;
const loadTemplates = () => templatePromise ||= fetch('/agents/agents.json').then(response => {
  if (!response.ok) throw new Error('The local agent portrait library is unavailable.');
  return response.json() as Promise<Array<{ name: string; file: string }>>;
}).then(manifest => Promise.all(manifest.map(async item => ({ ...item, image: await loadImage(`/agents/${encodeURIComponent(item.file)}`) }))));

export async function createValorantAgentRegionClassifier(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }) {
  const width = Number(image.naturalWidth || (image as any).width); const height = Number(image.naturalHeight || (image as any).height);
  const templates = await loadTemplates();
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true }); if (!sourceContext) throw new Error('Agent portrait matching is unavailable.');
  sourceContext.drawImage(image, 0, 0, width, height);
  return (region: { left: number; top: number; width: number; height: number }, background: [number, number, number]) => {
    const crop = document.createElement('canvas'); crop.width = crop.height = 32;
    const cropContext = crop.getContext('2d', { willReadFrequently: true }); if (!cropContext) return null;
    cropContext.drawImage(source, region.left, region.top, region.width, region.height, 0, 0, 32, 32);
    const actual = cropContext.getImageData(0, 0, 32, 32).data;
    const scores: AgentTemplateScore[] = [];
    for (const template of templates) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) continue;
      context.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`; context.fillRect(0, 0, 32, 32);
      context.drawImage(template.image, 0, 0, 32, 32);
      const expected = context.getImageData(0, 0, 32, 32).data;
      scores.push({ name: template.name, score: agentPortraitDistance(actual, expected) });
    }
    const strict = chooseAgentMatch(scores);
    if (strict) return strict;
    // Timeline portraits are smaller and sometimes tinted by the selected
    // round. Use a deliberately narrow relaxed fallback here only; the final
    // scoreboard classifier retains the stricter release threshold.
    const ranked = scores.sort((a, b) => a.score - b.score);
    return ranked[0]?.score <= 16_000 && ranked[1]?.score / Math.max(1, ranked[0].score) >= 1.01
      ? ranked[0].name
      : null;
  };
}

/** Score the ten fixed post-match portrait cells against the bundled agent art. */
export async function scoreValorantScoreboardAgents(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }, layout: 'custom' | 'competitive' = 'custom', rowOffset = 0) {
  const width = Number(image.naturalWidth || (image as any).width); const height = Number(image.naturalHeight || (image as any).height);
  if (width / height < 1.72 || width / height > 1.82) return Array.from({ length: 10 }, () => [] as AgentTemplateScore[]);
  const templates = await loadTemplates();
  const sx = width / 1920; const sy = height / 1080;
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true }); if (!sourceContext) throw new Error('Agent portrait matching is unavailable.');
  sourceContext.drawImage(image, 0, 0, width, height);
  const matches: AgentTemplateScore[][] = [];
  for (let row = 0; row < 10; row += 1) {
    // Portrait column: custom table starts at x=387, competitive at x=348.
    // The tint is sampled from the same shifted row as the crop.
    const left = Math.round((layout === 'competitive' ? 359 : 398) * sx), top = Math.round((321 + rowOffset + row * 48) * sy), cropWidth = Math.round(40 * sx), cropHeight = Math.round(48 * sy);
    const crop = document.createElement('canvas'); crop.width = crop.height = 32;
    const cropContext = crop.getContext('2d', { willReadFrequently: true }); if (!cropContext) throw new Error('Agent portrait matching is unavailable.');
    cropContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, 32, 32);
    const actual = cropContext.getImageData(0, 0, 32, 32).data;
    const background = sourceContext.getImageData(Math.round(500 * sx), Math.round((340 + rowOffset + row * 48) * sy), 1, 1).data;
    const scores: AgentTemplateScore[] = [];
    for (const template of templates) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) continue;
      context.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`; context.fillRect(0, 0, 32, 32);
      context.drawImage(template.image, 0, 0, 32, 32);
      const expected = context.getImageData(0, 0, 32, 32).data;
      scores.push({ name: template.name, score: rawPortraitDistance(actual, expected) });
    }
    matches.push(scores.sort((a, b) => a.score - b.score));
  }
  return matches;
}

/**
 * Prefer the calibrated portrait grid. The separator-based row offset is a
 * text-row measurement and a few pixels of it pushes the 48px portrait crop
 * off its cell, so it is only a fallback for rows the fixed grid cannot match.
 */
export function chooseScoreboardAgents(fixed: readonly AgentTemplateScore[][], shifted: readonly AgentTemplateScore[][] | null) {
  return fixed.map((scores, row) => chooseAgentMatch(scores) ?? (shifted?.[row] ? chooseAgentMatch(shifted[row]) : null));
}

/** Match the ten fixed post-match portrait cells against the bundled agent art. */
export async function classifyValorantScoreboardAgents(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }, layout: 'custom' | 'competitive' = 'custom', rowOffset = 0) {
  const fixed = await scoreValorantScoreboardAgents(image, layout, 0);
  return chooseScoreboardAgents(fixed, rowOffset ? await scoreValorantScoreboardAgents(image, layout, rowOffset) : null);
}
