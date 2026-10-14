export interface AgentTemplateScore { name: string; score: number }

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
      let error = 0;
      for (let index = 0; index < actual.length; index += 4) error += (actual[index] - expected[index]) ** 2 + (actual[index + 1] - expected[index + 1]) ** 2 + (actual[index + 2] - expected[index + 2]) ** 2;
      scores.push({ name: template.name, score: error / (32 * 32 * 3) });
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
export async function scoreValorantScoreboardAgents(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }) {
  const width = Number(image.naturalWidth || (image as any).width); const height = Number(image.naturalHeight || (image as any).height);
  if (width / height < 1.72 || width / height > 1.82) return Array.from({ length: 10 }, () => [] as AgentTemplateScore[]);
  const templates = await loadTemplates();
  const sx = width / 1920; const sy = height / 1080;
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true }); if (!sourceContext) throw new Error('Agent portrait matching is unavailable.');
  sourceContext.drawImage(image, 0, 0, width, height);
  const matches: AgentTemplateScore[][] = [];
  for (let row = 0; row < 10; row += 1) {
    const left = Math.round(398 * sx), top = Math.round((321 + row * 48) * sy), cropWidth = Math.round(40 * sx), cropHeight = Math.round(48 * sy);
    const crop = document.createElement('canvas'); crop.width = crop.height = 32;
    const cropContext = crop.getContext('2d', { willReadFrequently: true }); if (!cropContext) throw new Error('Agent portrait matching is unavailable.');
    cropContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, 32, 32);
    const actual = cropContext.getImageData(0, 0, 32, 32).data;
    const background = sourceContext.getImageData(Math.round(500 * sx), Math.round((340 + row * 48) * sy), 1, 1).data;
    const scores: AgentTemplateScore[] = [];
    for (const template of templates) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) continue;
      context.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`; context.fillRect(0, 0, 32, 32);
      context.drawImage(template.image, 0, 0, 32, 32);
      const expected = context.getImageData(0, 0, 32, 32).data;
      let error = 0;
      for (let index = 0; index < actual.length; index += 4) {
        error += (actual[index] - expected[index]) ** 2 + (actual[index + 1] - expected[index + 1]) ** 2 + (actual[index + 2] - expected[index + 2]) ** 2;
      }
      scores.push({ name: template.name, score: error / (32 * 32 * 3) });
    }
    matches.push(scores.sort((a, b) => a.score - b.score));
  }
  return matches;
}

/** Match the ten fixed post-match portrait cells against the bundled agent art. */
export async function classifyValorantScoreboardAgents(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }) {
  return (await scoreValorantScoreboardAgents(image)).map(chooseAgentMatch);
}
