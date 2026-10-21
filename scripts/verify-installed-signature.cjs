// node scripts/verify-installed-signature.cjs <file>...
// Each file must carry a Valid Authenticode signature from a publisher in
// desktop/update-trust.json: the same check installed apps apply to updates.
const { createUpdateTrust } = require('../desktop/update-trust.cjs');

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Name at least one file to verify.');
  const trust = createUpdateTrust();
  const results = [];
  for (const file of files) results.push({ file, problem: await trust.verify(file) });
  console.log(JSON.stringify({ publisherNames: trust.publisherNames, results }, null, 2));
  if (results.some(item => item.problem)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
