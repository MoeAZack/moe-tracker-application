const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const FORMAT = 'moetracker-encrypted/v1';
const MAX_PLAINTEXT_BYTES = 9 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 13 * 1024 * 1024;
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function passwordValue(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 256) throw new Error('Package password must be between 8 and 256 characters.');
  return password;
}

async function key(password, salt) {
  return Buffer.from(await scrypt(passwordValue(password), salt, 32, SCRYPT));
}

async function encryptPortablePackage(plaintext, password) {
  const bytes = Buffer.from(plaintext);
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new Error('Portable package exceeds the 9 MB safety limit.');
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', await key(password, salt), iv);
  cipher.setAAD(Buffer.from(FORMAT));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const envelope = { format: FORMAT, cipher: 'aes-256-gcm', kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') }, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  return Buffer.from(JSON.stringify(envelope));
}

function encryptedEnvelope(bytes) {
  const input = Buffer.from(bytes);
  if (input.length > MAX_ENVELOPE_BYTES) throw new Error('Encrypted package exceeds the safety limit.');
  let parsed; try { parsed = JSON.parse(input.toString('utf8')); } catch { return null; }
  return parsed?.format === FORMAT ? parsed : null;
}

async function decryptPortablePackage(input, password) {
  const bytes = Buffer.from(input); const envelope = encryptedEnvelope(bytes);
  if (!envelope) return bytes;
  try {
    if (envelope.cipher !== 'aes-256-gcm' || envelope.kdf?.name !== 'scrypt' || envelope.kdf.N !== SCRYPT.N || envelope.kdf.r !== SCRYPT.r || envelope.kdf.p !== SCRYPT.p) throw new Error('unsupported');
    const salt = Buffer.from(String(envelope.kdf.salt || ''), 'base64'); const iv = Buffer.from(String(envelope.iv || ''), 'base64'); const tag = Buffer.from(String(envelope.tag || ''), 'base64'); const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PLAINTEXT_BYTES) throw new Error('invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', await key(password, salt), iv); decipher.setAAD(Buffer.from(FORMAT)); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('large');
    return plaintext;
  } catch {
    throw new Error('The encrypted package password is incorrect or the file was changed.');
  }
}

module.exports = { FORMAT, MAX_ENVELOPE_BYTES, encryptPortablePackage, decryptPortablePackage, encryptedEnvelope };
