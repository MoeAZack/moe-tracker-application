import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { evidenceCandidates } = require('../desktop/evidence-handoff.cjs');

const replay = 'a'.repeat(64);
const evidence = 'b'.repeat(64);

describe('desktop collector evidence handoff', () => {
  it('selects a finished collector artifact exactly once', () => {
    const root = path.resolve('collector-fixture');
    const file = path.join(root, 'evidence', replay.slice(0, 2), `${replay}.json`);
    const manifest = { files: { replay: { sha256: replay, evidenceSha256: evidence, evidencePath: file, processedAt: '2026-10-13T09:00:00.000Z' } } };
    expect(evidenceCandidates(manifest, root, [])).toEqual([{ id: `${replay}:${evidence}`, file, processedAt: '2026-10-13T09:00:00.000Z' }]);
    expect(evidenceCandidates(manifest, root, [`${replay}:${evidence}`])).toEqual([]);
  });

  it('rejects malformed hashes and paths outside the collector evidence directory', () => {
    const root = path.resolve('collector-fixture');
    const outside = path.resolve('outside.json');
    expect(evidenceCandidates({ files: { replay: { sha256: replay, evidenceSha256: evidence, evidencePath: outside } } }, root, [])).toEqual([]);
    expect(evidenceCandidates({ files: { replay: { sha256: 'not-a-hash', evidenceSha256: evidence, evidencePath: outside } } }, root, [])).toEqual([]);
  });
});
