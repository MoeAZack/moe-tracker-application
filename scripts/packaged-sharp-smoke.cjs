const path = require('node:path');

const appArchive = process.argv[2];
if (!appArchive) throw new Error('Pass the packaged app.asar path.');

const sharp = require(path.join(appArchive, 'node_modules', 'sharp'));
sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
  .png()
  .toBuffer()
  .then(buffer => process.exit(buffer.length > 0 ? 0 : 41))
  .catch(error => { console.error(error); process.exit(42); });
