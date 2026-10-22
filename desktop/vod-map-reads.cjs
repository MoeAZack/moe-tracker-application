// Map names on agent-select frames. A frame whose text names no known map can
// still resolve through map reads the coach corrected before: the renderer
// passes those as { token, map } hints and keeps the learning itself.
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function mapReadTokens(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3 && token.length <= 20))].slice(0, 60);
}

function normalizeMapHints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).map(item => ({ token: String(item?.token || '').toLowerCase(), map: String(item?.map || '').trim().slice(0, 100) })).filter(item => /^[a-z0-9]{3,20}$/.test(item.token) && item.map);
}

function resolveBoundaryMap(text, mapNames, hints = []) {
  const known = [...new Set((mapNames || []).map(name => String(name || '').trim()).filter(Boolean))];
  const flat = normalized(text); const mapRead = mapReadTokens(text);
  const direct = known.find(name => flat.includes(normalized(name)));
  if (direct) return { map: direct, mapSource: 'read', mapRead, firedTokens: [] };
  const byKey = new Map(known.map(name => [normalized(name), name]));
  const votes = new Set(); const firedTokens = [];
  for (const hint of normalizeMapHints(hints)) {
    const map = byKey.get(normalized(hint.map));
    if (map && mapRead.includes(hint.token)) { votes.add(map); firedTokens.push(hint.token); }
  }
  // Hints that disagree prove nothing; the coach picks the map.
  if (votes.size === 1) return { map: [...votes][0], mapSource: 'learned', mapRead, firedTokens };
  return { map: null, mapSource: null, mapRead, firedTokens: [] };
}

module.exports = { mapReadTokens, normalizeMapHints, resolveBoundaryMap };
