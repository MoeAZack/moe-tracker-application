import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { FORMAT, encryptPortablePackage, decryptPortablePackage, encryptedEnvelope } = require('../desktop/portable-crypto.cjs');

describe('password-encrypted portable packages', () => {
  it('round-trips with scrypt and authenticated encryption', async () => {
    const plaintext = Buffer.from(JSON.stringify({ format: 'moetracker-package/v1', payload: { matches: [] } }));
    const encrypted = await encryptPortablePackage(plaintext, 'correct horse battery staple');
    expect(encryptedEnvelope(encrypted)).toMatchObject({ format: FORMAT, cipher: 'aes-256-gcm', kdf: { name: 'scrypt', N: 32768, r: 8, p: 1 } });
    expect(await decryptPortablePackage(encrypted, 'correct horse battery staple')).toEqual(plaintext);
  });

  it('rejects wrong passwords, tampering, and weak passwords without leaking details', async () => {
    const encrypted = await encryptPortablePackage(Buffer.from('{"safe":true}'), 'strong-password');
    await expect(decryptPortablePackage(encrypted, 'wrong-password')).rejects.toThrow(/incorrect or the file was changed/);
    const envelope = JSON.parse(encrypted.toString()); envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    await expect(decryptPortablePackage(Buffer.from(JSON.stringify(envelope)), 'strong-password')).rejects.toThrow(/incorrect or the file was changed/);
    await expect(encryptPortablePackage(Buffer.from('{}'), 'short')).rejects.toThrow(/between 8 and 256/);
  });

  it('passes plaintext packages through for backward compatibility', async () => {
    const plaintext = Buffer.from('{"format":"moetracker-package/v1"}');
    expect(await decryptPortablePackage(plaintext, '')).toEqual(plaintext);
  });
});
