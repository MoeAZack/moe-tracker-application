import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateSignature } = require('../desktop/update-trust.cjs');

/**
 * Signature failures for a release candidate. A signed public candidate needs
 * every expected file inspected on Windows, Valid, and signed by a publisher in
 * desktop/update-trust.json; anything not proven counts as a failure.
 */
export function signatureFailures({ requireSigned, platform, expectedFiles, signatures, publisherNames, inspectionError = null }) {
  if (!requireSigned) return [];
  if (platform !== 'win32') return ['Signatures can only be verified on Windows; this audit cannot approve a signed public candidate here.'];
  if (inspectionError) return [`Authenticode inspection failed: ${inspectionError}`];
  if (!publisherNames.length) return ['No trusted publisher is configured in desktop/update-trust.json, so no signature can be accepted.'];
  const failures = [];
  for (const file of expectedFiles) {
    const record = signatures.find(item => String(item?.path || '').toLowerCase() === file.toLowerCase());
    const problem = evaluateSignature(record || null, { publisherNames, file });
    if (problem) failures.push(`${file}: ${problem}`);
  }
  return failures;
}
