const fs = require('node:fs');
const path = require('node:path');

/**
 * The commit the packaged renderer was built from, as vite wrote it to
 * dist/build.json. The local service reports it at /api/health, so the
 * desktop app names the same commit there as the page does.
 */
function bundledRevision(codeRoot) {
  try {
    const revision = JSON.parse(fs.readFileSync(path.join(codeRoot, 'dist', 'build.json'), 'utf8')).revision;
    return typeof revision === 'string' && /^[0-9a-f]{7,40}(-dirty)?$/i.test(revision) ? revision : null;
  } catch { return null; }
}

module.exports = { bundledRevision };
