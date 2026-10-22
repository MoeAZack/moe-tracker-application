import { execFileSync } from 'node:child_process';

// The short commit of the working tree, marked "-dirty" when it has local
// changes, so a deployment built from an uncommitted tree is never mistaken
// for the commit it started from. APP_REVISION overrides it in CI.
export function buildRevision(env = process.env) {
  if (env.APP_REVISION) return env.APP_REVISION;
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sha = git('rev-parse', '--short=12', 'HEAD');
    return git('status', '--porcelain', '--untracked-files=no') ? `${sha}-dirty` : sha;
  } catch {
    return 'development';
  }
}
