import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildRevision } from './build-revision.mjs';

// Builds once with a fixed revision and stamps it on the deployment, so
// /api/health (worker) and /build.json (static bundle) name the same commit.
const target = process.argv[2];
if (target !== 'worker' && target !== 'pages') throw new Error('Usage: node scripts/cf-deploy.mjs <worker|pages>');
const revision = buildRevision();
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const env = { ...process.env, APP_REVISION: revision };
const run = command => execSync(command, { stdio: 'inherit', env });
run('npm run build');
if (target === 'worker') run(`npx wrangler --config wrangler.worker.jsonc deploy --var APP_REVISION:${revision} --var APP_VERSION:${version}`);
else {
  run('npm run cf:pages:prepare');
  // moezack is the canonical site. moetracker-site gets the same bundle so its
  // page visits redirect there while installed desktops keep using its /api.
  for (const project of ['moezack', 'moetracker-site']) run(`npx wrangler pages deploy dist --project-name ${project} --branch main`);
}
console.log(`Deployed ${target} ${version} (${revision}).`);
