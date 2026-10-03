/**
 * Encryption for safety/medical alert text (AES-256-GCM), and for the free text of a
 * substitute's end-of-day report, which uses the same key ring (DECISIONS D-054).
 *
 * Alerts are encrypted before they reach the database, so database backups, dumps or
 * support access never expose them. What the text belongs to is bound in as additional
 * authenticated data (a student's id for an alert, `sub-report:<planId>` for a report): a
 * ciphertext copied onto another student or another plan will not decrypt.
 * Format: v<version>.<iv>.<ciphertext>.<tag> (base64url parts).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type KeyRing = { current: number; keys: Map<number, Buffer> };

export class AlertCryptoError extends Error {}

/**
 * Parses a "version:base64key" list (32-byte keys). `envName` is the setting it came from, so
 * a configuration error names the right one (the same format serves SUB_CODE_HMAC_KEYS).
 */
export function parseKeyRing(spec: string, envName = 'ALERTS_ENCRYPTION_KEYS'): KeyRing | null {
  const keys = new Map<number, Buffer>();
  for (const part of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [versionText, keyText] = part.split(':');
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1 || !keyText) {
      throw new AlertCryptoError(`${envName} must look like "1:<base64 key>"`);
    }
    const key = Buffer.from(keyText, 'base64');
    if (key.length !== 32)
      throw new AlertCryptoError(`${envName} key v${version} must be 32 bytes`);
    keys.set(version, key);
  }
  if (keys.size === 0) return null;
  return { current: Math.max(...keys.keys()), keys };
}

/** Encrypts text with the newest key, bound to `aad` (what the text belongs to). */
export function encryptText(
  plaintext: string,
  aad: string,
  ring: KeyRing,
): { ciphertext: string; keyVersion: number } {
  const key = ring.keys.get(ring.current)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const parts = [iv, body, tag].map((b) => b.toString('base64url'));
  return { ciphertext: `v${ring.current}.${parts.join('.')}`, keyVersion: ring.current };
}

/** Decrypts text encrypted with `encryptText`; throws if it was bound to another `aad`. */
export function decryptText(ciphertext: string, aad: string, ring: KeyRing): string {
  const match = /^v(\d+)\.([\w-]+)\.([\w-]*)\.([\w-]+)$/.exec(ciphertext);
  if (!match) throw new AlertCryptoError('malformed ciphertext');
  const key = ring.keys.get(Number(match[1]));
  if (!key) throw new AlertCryptoError(`no key for version ${match[1]}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(match[2]!, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(match[4]!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(match[3]!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** An alert's text, bound to its student. */
export function encryptAlert(
  plaintext: string,
  studentId: string,
  ring: KeyRing,
): { ciphertext: string; keyVersion: number } {
  return encryptText(plaintext, studentId, ring);
}

export function decryptAlert(ciphertext: string, studentId: string, ring: KeyRing): string {
  return decryptText(ciphertext, studentId, ring);
}
