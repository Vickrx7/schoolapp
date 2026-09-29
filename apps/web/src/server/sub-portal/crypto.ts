/**
 * Keyed hashes for substitute access (DECISIONS D-050, D-051). The web server holds
 * SUB_CODE_HMAC_KEYS; the database only ever sees HMACs:
 * - a code as HMAC-SHA256(key, "sub-code:v1:" + normalized code), stored as sha256 of that MAC,
 *   so a database dump cannot be brute-forced without the key;
 * - the device cookie and the client address, so throttling stores no raw cookie or address.
 * Rotation: the highest version is current; codes are checked against every key in the ring
 * (at most two: the current key and the previous one). Not server-only so it can be unit tested.
 */
import { createHmac } from 'node:crypto';
import { AlertCryptoError, parseKeyRing, type KeyRing } from '../alerts-crypto';

/** The current key and the previous one, during a rotation. */
export const MAX_SUB_CODE_KEYS = 2;

/**
 * The key ring from SUB_CODE_HMAC_KEYS, or null when it is empty. Throws on a malformed value
 * or on more than two keys (the database accepts at most two MACs per attempt).
 */
export function subCodeRing(spec: string): KeyRing | null {
  const ring = parseKeyRing(spec, 'SUB_CODE_HMAC_KEYS');
  if (ring && ring.keys.size > MAX_SUB_CODE_KEYS) {
    throw new AlertCryptoError(
      'SUB_CODE_HMAC_KEYS holds at most two keys: the current one and the previous one',
    );
  }
  return ring;
}

const hmacHex = (key: Buffer, message: string) =>
  createHmac('sha256', key).update(message, 'utf8').digest('hex');

const currentKey = (ring: KeyRing) => ring.keys.get(ring.current)!;

/** The MAC a new code is stored under (current key). `normalized` is normalizeAccessCode's. */
export function codeMac(normalized: string, ring: KeyRing): string {
  return hmacHex(currentKey(ring), `sub-code:v1:${normalized}`);
}

/** The MACs a typed code is looked up with: one per key, the current key first. */
export function codeMacs(normalized: string, ring: KeyRing): string[] {
  return [...ring.keys.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, key]) => hmacHex(key, `sub-code:v1:${normalized}`));
}

/** The device's key for the device limit and throttling (HMAC of its HttpOnly cookie). */
export function deviceKey(cookieValue: string, ring: KeyRing): string {
  return hmacHex(currentKey(ring), `sub-device:${cookieValue}`);
}

/** The network's key for throttling (HMAC of the client address, or of 'unknown'). */
export function ipKey(ip: string, ring: KeyRing): string {
  return hmacHex(currentKey(ring), `sub-ip:${ip}`);
}
