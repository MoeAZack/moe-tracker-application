const path = require('node:path');

const HASH = /^[a-f0-9]{64}$/;

function samePath(left, right) {
  const normalize = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
  return normalize(left) === normalize(right);
}

function evidenceCandidates(manifest, collectorRoot, completedIds = []) {
  const completed = new Set(completedIds);
  return Object.values(manifest?.files || {})
    .flatMap(record => {
      const replaySha256 = String(record?.sha256 || '').toLowerCase();
      const evidenceSha256 = String(record?.evidenceSha256 || '').toLowerCase();
      if (!HASH.test(replaySha256) || !HASH.test(evidenceSha256)) return [];
      const id = `${replaySha256}:${evidenceSha256}`;
      if (completed.has(id)) return [];
      const expected = path.resolve(collectorRoot, 'evidence', replaySha256.slice(0, 2), `${replaySha256}.json`);
      if (!record?.evidencePath || !samePath(record.evidencePath, expected)) return [];
      return [{ id, file: expected, processedAt: String(record.processedAt || '') }];
    })
    .sort((left, right) => left.processedAt.localeCompare(right.processedAt));
}

module.exports = { evidenceCandidates };
