import type { ScreenshotKillEvent, ScreenshotPlayerRoundEvidence } from '../src/types';
import { createValorantAgentRegionClassifier } from './localAgentClassifier';
import { createValorantWeaponRegionClassifier } from './localWeaponClassifier';

type ImageLike = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number };

const portraitPixels = (
  source: HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 28;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Round event portrait matching is unavailable.');
  context.drawImage(source, left, top, width, height, 0, 0, 28, 28);
  return context.getImageData(0, 0, 28, 28).data;
};

const pixelError = (left: Uint8ClampedArray, right: Uint8ClampedArray) => {
  let error = 0;
  for (let index = 0; index < left.length; index += 4) {
    error += (left[index] - right[index]) ** 2;
    error += (left[index + 1] - right[index + 1]) ** 2;
    error += (left[index + 2] - right[index + 2]) ** 2;
  }
  return error / (28 * 28 * 3);
};

const pixelVariance = (pixels: Uint8ClampedArray) => {
  let total = 0; let squared = 0; let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722;
    total += luminance; squared += luminance * luminance; count += 1;
  }
  const mean = total / Math.max(1, count);
  return squared / Math.max(1, count) - mean * mean;
};

const colourError = (left: Uint8ClampedArray, right: Uint8ClampedArray) =>
  (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;

/**
 * Read the ordered kill feed by matching its portraits to the ten labelled
 * portraits in the same round screenshot. This avoids guessing names with OCR.
 */
export async function classifyValorantRoundEvents(image: ImageLike, players: readonly (ScreenshotPlayerRoundEvidence & { agent?: string | null })[]) {
  const width = Number(image.naturalWidth || (image as any).width);
  const height = Number(image.naturalHeight || (image as any).height);
  if (width / height < 1.72 || width / height > 1.82 || players.length !== 10) return { events: [] as ScreenshotKillEvent[], complete: false };
  const sx = width / 1920; const sy = height / 1080;
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Round event portrait matching is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  const classifyAgent = await createValorantAgentRegionClassifier(image);
  const classifyWeapon = await createValorantWeaponRegionClassifier(image);
  const rowTop = (row: number) => Math.round((470 + row * 42.4) * sy);
  const table = players.map((_player, row) => portraitPixels(source, Math.round(1222 * sx), rowTop(row), Math.round(38 * sx), Math.round(42 * sy)));
  const tableColours = players.map((_player, row) => context.getImageData(Math.round(1450 * sx), rowTop(row) + Math.round(20 * sy), 1, 1).data);
  const hasVictimStripe = (top: number) => {
    const pixels = context.getImageData(Math.round(696 * sx), top + Math.round(3 * sy), Math.max(1, Math.round(4 * sx)), Math.max(1, Math.round(34 * sy))).data;
    let vivid = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const high = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
      const low = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
      if (high >= 105 && high - low >= 45) vivid += 1;
    }
    return vivid >= Math.max(4, Math.round(6 * sy));
  };
  const match = (pixels: Uint8ClampedArray, candidates: number[]) => {
    if (pixelVariance(pixels) < 180) return null;
    const ranked = candidates.map(index => ({ index, error: pixelError(pixels, table[index]) })).sort((a, b) => a.error - b.error);
    const best = ranked[0]; const next = ranked[1];
    return best && best.error <= 10_000 && (!next || next.error / Math.max(1, best.error) >= 1.025) ? best.index : null;
  };
  const events: ScreenshotKillEvent[] = [];
  let hadPartialEvent = false;
  let sawUnmatchedBetweenKills = false;
  for (let row = 0; row < 11; row += 1) {
    const top = rowTop(row);
    const killerPortrait = portraitPixels(source, Math.round(368 * sx), top, Math.round(36 * sx), Math.round(42 * sy));
    const victimPortrait = portraitPixels(source, Math.round(656 * sx), top, Math.round(40 * sx), Math.round(42 * sy));
    // The thin victim stripe changes brightness with the selected round and
    // can disappear in compressed captures. A real portrait is the reliable
    // fallback; plant/defuse rows have a flat victim area and remain excluded.
    if (!hasVictimStripe(top) && pixelVariance(victimPortrait) < 180) continue;
    // Sample the narrow gap between the timestamp and weapon. The weapon
    // silhouette starts around x=460 and is bright enough to erase the
    // green/red team tint used to resolve mirrored agent compositions.
    const eventColour = context.getImageData(Math.round(452 * sx), top + Math.round(20 * sy), 1, 1).data;
    const closestColourRow = tableColours.map((colour, index) => ({ index, error: colourError(eventColour, colour) })).sort((a, b) => a.error - b.error)[0]?.index;
    const redGreenDelta = eventColour[0] - eventColour[1];
    const killerTeam = redGreenDelta >= 10 ? 'theirs' : redGreenDelta <= -10 ? 'ours' : closestColourRow === undefined ? null : players[closestColourRow].team;
    const killerCandidates = players.map((_player, index) => index).filter(index => players[index].team === killerTeam);
    const victimCandidates = players.map((_player, index) => index).filter(index => players[index].team !== killerTeam);
    const backgroundFor = (candidates: number[]): [number, number, number] => {
      const colour = tableColours[candidates[0]] || eventColour;
      return [colour[0], colour[1], colour[2]];
    };
    const killerAgent = classifyAgent(
      { left: Math.round(368 * sx), top, width: Math.round(36 * sx), height: Math.round(42 * sy) },
      backgroundFor(killerCandidates),
    );
    const victimAgent = classifyAgent(
      { left: Math.round(656 * sx), top, width: Math.round(40 * sx), height: Math.round(42 * sy) },
      backgroundFor(victimCandidates),
    );
    const uniqueAgentRow = (agent: string | null, candidates: number[]) => {
      if (!agent) return null;
      const rows = candidates.filter(index => players[index].agent === agent);
      return rows.length === 1 ? rows[0] : null;
    };
    const killer = uniqueAgentRow(killerAgent, killerCandidates) ?? (killerTeam ? match(killerPortrait, killerCandidates) : null);
    const victim = uniqueAgentRow(victimAgent, victimCandidates) ?? (killerTeam ? match(victimPortrait, victimCandidates) : null);
    if (killer === null && victim === null) {
      if (events.length) sawUnmatchedBetweenKills = true;
      continue;
    }
    if (sawUnmatchedBetweenKills) sawUnmatchedBetweenKills = false; // plant rows may appear between eliminations
    const killerPlayer = killer === null ? null : players[killer];
    const victimPlayer = victim === null ? null : players[victim];
    if (!killerPlayer || !victimPlayer) hadPartialEvent = true;
    events.push({
      sequence: events.length + 1,
      sourceRow: row,
      killerPlayerId: killerPlayer ? killerPlayer.playerId || `name:${killerPlayer.displayName.trim().toLocaleLowerCase()}` : null,
      victimPlayerId: victimPlayer ? victimPlayer.playerId || `name:${victimPlayer.displayName.trim().toLocaleLowerCase()}` : null,
      killerTeam: killerPlayer?.team || killerTeam,
      victimTeam: victimPlayer?.team || (killerTeam === 'ours' ? 'theirs' : killerTeam === 'theirs' ? 'ours' : null),
      weapon: classifyWeapon({ left: Math.round(468 * sx), top: top + Math.round(5 * sy), width: Math.round(132 * sx), height: Math.round(31 * sy) }),
    });
  }
  return { events, complete: events.length > 0 && !hadPartialEvent };
}
