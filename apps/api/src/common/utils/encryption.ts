import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte AES key from the existing SESSION_SECRET env var.
 * No extra env var needed — every environment already has SESSION_SECRET.
 * Uses SHA-256 to produce a fixed-length key from any-length secret.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.AI_KEY_ENCRYPTION_SECRET ||
    process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'No encryption key available. Set SESSION_SECRET (already required for auth) ' +
      'or AI_KEY_ENCRYPTION_SECRET (64-char hex, optional override).',
    );
  }
  // If it's a 64-char hex string, use it directly (dedicated key). Otherwise
  // derive a 32-byte key via SHA-256 from SESSION_SECRET.
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 * Returns a string in the format: `iv:authTag:ciphertext` (base64-encoded segments).
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an API key previously encrypted with `encryptApiKey`.
 */
export function decryptApiKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted key format — expected iv:authTag:ciphertext');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
