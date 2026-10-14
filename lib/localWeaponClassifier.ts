export interface WeaponTemplateScore { name: string; score: number }

const loadImage = async (url: string) => {
  const image = new Image(); image.src = url; await image.decode(); return image;
};

let templatePromise: Promise<Array<{ name: string; image: HTMLImageElement }>> | null = null;
const loadTemplates = () => templatePromise ||= fetch('/weapons/weapons.json').then(response => {
  if (!response.ok) throw new Error('The local weapon icon library is unavailable.');
  return response.json() as Promise<Array<{ name: string; file: string }>>;
}).then(manifest => Promise.all(manifest.map(async item => ({ name: item.name, image: await loadImage(`/weapons/${encodeURIComponent(item.file)}`) }))));

const normalizedMask = (pixels: Uint8ClampedArray, width: number, height: number, alphaOnly = false) => {
  const lit = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (alphaOnly) return pixels[index + 3] >= 80;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    return Math.min(r, g, b) >= 145 && Math.max(r, g, b) - Math.min(r, g, b) <= 70;
  };
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (lit(x, y)) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top || (right - left + 1) * (bottom - top + 1) < 40) return null;
  const outputWidth = 96, outputHeight = 28;
  const output = new Uint8Array(outputWidth * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) for (let x = 0; x < outputWidth; x += 1) {
    const sourceX = Math.min(right, left + Math.floor((x + .5) * (right - left + 1) / outputWidth));
    const sourceY = Math.min(bottom, top + Math.floor((y + .5) * (bottom - top + 1) / outputHeight));
    output[y * outputWidth + x] = lit(sourceX, sourceY) ? 1 : 0;
  }
  return output;
};

const maskError = (left: Uint8Array, right: Uint8Array) => {
  let difference = 0; let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] || right[index]) union += 1;
    if (left[index] !== right[index]) difference += 1;
  }
  return union ? difference / union : 1;
};

export function chooseWeaponMatch(scores: readonly WeaponTemplateScore[]) {
  const ranked = [...scores].filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score);
  if (ranked.length < 2 || ranked[0].score > .5 || ranked[1].score - ranked[0].score < .018) return null;
  return ranked[0].name;
}

const flipMask = (mask: Uint8Array) => {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < 28; y += 1) for (let x = 0; x < 96; x += 1) output[y * 96 + x] = mask[y * 96 + (95 - x)];
  return output;
};

/** Strictly match the white kill-feed silhouette against bundled game icons. */
export async function createValorantWeaponRegionClassifier(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }) {
  const width = Number(image.naturalWidth || (image as any).width); const height = Number(image.naturalHeight || (image as any).height);
  const templates = await loadTemplates();
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const context = source.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Weapon icon matching is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  const templateMasks = templates.map(template => {
    const canvas = document.createElement('canvas'); canvas.width = template.image.naturalWidth; canvas.height = template.image.naturalHeight;
    const templateContext = canvas.getContext('2d', { willReadFrequently: true }); if (!templateContext) return { name: template.name, mask: null };
    templateContext.drawImage(template.image, 0, 0);
    return { name: template.name, mask: normalizedMask(templateContext.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, true) };
  });
  return (region: { left: number; top: number; width: number; height: number }) => {
    const pixels = context.getImageData(region.left, region.top, region.width, region.height).data;
    const actual = normalizedMask(pixels, region.width, region.height);
    if (!actual) return null;
    return chooseWeaponMatch(templateMasks.filter(item => item.mask).map(item => ({ name: item.name, score: Math.min(maskError(actual, item.mask!), maskError(actual, flipMask(item.mask!))) })));
  };
}
