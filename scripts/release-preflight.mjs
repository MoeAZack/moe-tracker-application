// First step of the tag release workflow. Fails before anything is built when
// a signed, trusted public release is impossible: no signing secrets, no
// trusted publisher for the updater, or a tag that is not v<package version>.
// Needs no installed dependencies, so it runs before npm ci.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadTrustedPublishers } = require('../desktop/update-trust.cjs');

export function releasePreflightFailures({ env, ref, packageVersion, publisherNames }) {
  const failures = [];
  for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD']) if (!String(env[name] || '').trim()) failures.push(`${name} is not configured; a public release must be signed.`);
  if (!publisherNames.length) failures.push('desktop/update-trust.json names no trusted publisher; installed apps could not verify this release.');
  if (ref !== `v${packageVersion}`) failures.push(`The release tag is ${ref || 'missing'}, expected v${packageVersion}.`);
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const failures = releasePreflightFailures({ env: process.env, ref: process.env.GITHUB_REF_NAME || '', packageVersion, publisherNames: loadTrustedPublishers() });
  console.log(JSON.stringify({ passed: failures.length === 0, packageVersion, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
