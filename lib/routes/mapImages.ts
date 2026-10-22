import fs from 'fs/promises';
import path from 'path';
import type { Express } from 'express';
import { DB_PATH } from '../store';
import { mapImageKey } from '../strategyBoard';

// The coach's own minimap per map, for strategy boards. Kept beside the
// workspace database on this PC, never in the database itself (images would
// bloat every save) and never in the repository.
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const MAX_MAP_IMAGE_BYTES = 3 * 1024 * 1024;
const root = () => path.resolve(process.env.MAP_IMAGE_DIR || path.join(path.dirname(DB_PATH), 'map-images'));

async function findImage(key: string) {
  for (const [type, extension] of Object.entries(TYPES)) {
    const file = path.join(root(), `${key}.${extension}`);
    if (await fs.stat(file).then(stat => stat.isFile(), () => false)) return { file, type };
  }
  return null;
}

/** Recognises the image from its first bytes, not from what the upload claims it is. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function registerMapImageRoutes(app: Express) {
  app.get('/api/map-images/:map', async (req, res) => {
    const key = mapImageKey(req.params.map);
    const found = key ? await findImage(key) : null;
    // No image yet is a normal state for a board, not an error: answer empty.
    if (!found) return res.status(204).end();
    res.setHeader('Content-Type', found.type);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(await fs.readFile(found.file));
  });

  // Body: { image: "data:image/png;base64,..." }. Players are read-only upstream.
  app.post('/api/map-images/:map', async (req, res) => {
    try {
      if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Coach access is required.' });
      const key = mapImageKey(req.params.map); if (!key) return res.status(400).json({ error: 'Choose a map.' });
      const match = typeof req.body?.image === 'string' ? req.body.image.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/) : null;
      if (!match) return res.status(400).json({ error: 'Send a PNG, JPEG or WebP image.' });
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.length > MAX_MAP_IMAGE_BYTES) return res.status(413).json({ error: 'The image is larger than 3 MB. Use a smaller minimap.' });
      const type = sniffImageType(bytes); if (!type) return res.status(400).json({ error: 'That file is not a PNG, JPEG or WebP image.' });
      await fs.mkdir(root(), { recursive: true });
      // One image per map: write the new one, then drop any older copy in another format.
      const target = path.join(root(), `${key}.${TYPES[type]}`); const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, bytes); await fs.rename(temporary, target);
      for (const extension of Object.values(TYPES)) if (extension !== TYPES[type]) await fs.rm(path.join(root(), `${key}.${extension}`), { force: true });
      res.json({ map: key, type, bytes: bytes.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });
}
