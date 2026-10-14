import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('public', 'weapons');
await mkdir(output, { recursive: true });
const response = await fetch('https://valorant-api.com/v1/weapons');
if (!response.ok) throw new Error(`Weapon metadata download failed (${response.status}).`);
const payload = await response.json();
const weapons = (payload.data || []).filter(item => item.displayName !== 'Melee' && item.killStreamIcon);
const manifest = [];
for (const weapon of weapons) {
  const file = `${weapon.displayName.replace(/[^a-z0-9]+/gi, '-')}.png`;
  const icon = await fetch(weapon.killStreamIcon);
  if (!icon.ok) throw new Error(`Weapon icon download failed for ${weapon.displayName} (${icon.status}).`);
  await writeFile(path.join(output, file), Buffer.from(await icon.arrayBuffer()));
  manifest.push({ name: weapon.displayName, file });
}
await writeFile(path.join(output, 'weapons.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Staged ${manifest.length} VALORANT kill-feed weapon icons.`);
