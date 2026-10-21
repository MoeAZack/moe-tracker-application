import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { releasePreflightFailures } from '../scripts/release-preflight.mjs';

const publisher = 'CN=Moe Tracker Publisher, O=Moe Tracker Publisher, C=EG';
const signed = { CSC_LINK: 'base64-certificate', CSC_KEY_PASSWORD: 'certificate-password' };

describe('tag release preflight', () => {
  it('passes only with signing secrets, a trusted publisher and the matching tag', () => {
    expect(releasePreflightFailures({ env: signed, ref: 'v0.2.0', packageVersion: '0.2.0', publisherNames: [publisher] })).toEqual([]);
    expect(releasePreflightFailures({ env: {}, ref: 'v0.2.0', packageVersion: '0.2.0', publisherNames: [publisher] })).toEqual(['CSC_LINK is not configured; a public release must be signed.', 'CSC_KEY_PASSWORD is not configured; a public release must be signed.']);
    expect(releasePreflightFailures({ env: { CSC_LINK: '  ', CSC_KEY_PASSWORD: 'x' }, ref: 'v0.2.0', packageVersion: '0.2.0', publisherNames: [publisher] })).toHaveLength(1);
    expect(releasePreflightFailures({ env: signed, ref: 'v0.2.0', packageVersion: '0.2.0', publisherNames: [] })).toEqual([expect.stringContaining('names no trusted publisher')]);
    expect(releasePreflightFailures({ env: signed, ref: 'v0.2.1', packageVersion: '0.2.0', publisherNames: [publisher] })).toEqual(['The release tag is v0.2.1, expected v0.2.0.']);
  });

  it('fails the real workflow step today: no secrets and no trusted publisher', () => {
    const env = { ...process.env, GITHUB_REF_NAME: 'v0.2.0', CSC_LINK: '', CSC_KEY_PASSWORD: '' };
    const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'release-preflight.mjs')], { env, encoding: 'utf8' });
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([expect.stringContaining('CSC_LINK'), expect.stringContaining('trusted publisher')]));
  });
});
