import type { LocalOcrRecognition } from './localOcrEngine';

const values = (text: string) => (text.match(/\d{1,3}/g) || []).map(Number);
const lines = (text: string) => text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);

export function parseLocalPerformanceRecognitions(recognitions: readonly LocalOcrRecognition[]) {
  const byId = new Map(recognitions.map(item => [item.regionId, item]));
  const score = values(byId.get('performance.score')?.text || '')[0] ?? null;
  const accolades = byId.get('performance.accolades')?.text || '';
  const hs = accolades.match(/HEADSHOTS?\D{0,8}(\d{1,3})/i)?.[1];
  const firstBloods = accolades.match(/FIRST\s*BLOODS?\D{0,8}(\d{1,2})/i)?.[1];
  return {
    performanceScore: score !== null && score <= 1000 ? score : null,
    hs: hs === undefined ? null : Math.min(100, Number(hs)),
    firstBloods: firstBloods === undefined ? null : Number(firstBloods),
    rawAccolades: accolades,
    fieldConfidence: Object.fromEntries(recognitions.map(item => [item.regionId, item.confidence])),
  };
}

export function parseLocalHeadToHeadRecognitions(recognitions: readonly LocalOcrRecognition[]) {
  const byId = new Map(recognitions.map(item => [item.regionId, item]));
  const numberCell = (id: string) => {
    const recognition = byId.get(id);
    if (!recognition) return null;
    // Tesseract commonly emits an empty token for the game's tiny zero glyph.
    // The resulting totals are still accepted only when they exactly match one
    // unique scoreboard K/D/A row, so a missed non-zero cannot be published.
    return values(recognition.text)[0] ?? 0;
  };
  const rows = Array.from({ length: 5 }, (_, index) => ({
    opponent: lines(byId.get(`h2h.${index}.opponent`)?.text || '')[0] || null,
    kills: numberCell(`h2h.${index}.kills`),
    deaths: numberCell(`h2h.${index}.deaths`),
    assists: numberCell(`h2h.${index}.assists`),
  }));
  const complete = rows.every(row => row.kills !== null && row.deaths !== null && row.assists !== null);
  return {
    rows: complete ? rows as Array<{ opponent: string | null; kills: number; deaths: number; assists: number }> : [],
    totals: complete ? rows.reduce((total, row) => ({ kills: total.kills + Number(row.kills), deaths: total.deaths + Number(row.deaths), assists: total.assists + Number(row.assists) }), { kills: 0, deaths: 0, assists: 0 }) : null,
    fieldConfidence: Object.fromEntries(recognitions.map(item => [item.regionId, item.confidence])),
  };
}
