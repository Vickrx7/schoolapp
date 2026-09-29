/**
 * Keys for throttling class devices (DECISIONS D-083, D-084). The web server holds
 * CLASS_PORTAL_HMAC_KEY (its own key, so an install with the Library module but without the
 * substitute portal works); the database only ever sees HMACs:
 *
 * - the device key: HMAC of the device cookie (`lynx_jouer_device`, 32 random bytes), prefix
 *   `class-device:`;
 * - the network key: HMAC of the client's network (`networkPrefix()`: an IPv4 address or an IPv6
 *   /64), prefix `class-net:`. An address is guessable, so its hash needs the key; a raw address
 *   is never stored (`class_join_failures`).
 *
 * The prefixes keep the two kinds apart: a device cookie can never collide with a network. The
 * device token (the session cookie) is not hashed here: the database stores its SHA-256 itself.
 * Changing the key only restarts the throttle counts. Pure (no server-only import) so it is
 * unit-tested; `keys.ts` reads the setting.
 */
import { createHmac } from 'node:crypto';

export class ClassPortalKeyError extends Error {}

/** The key from CLASS_PORTAL_HMAC_KEY (base64 of 32 bytes), or null when it is empty. */
export function classPortalKey(spec: string): Buffer | null {
  const text = spec.trim();
  if (!text) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) {
    throw new ClassPortalKeyError('CLASS_PORTAL_HMAC_KEY must be base64');
  }
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32) {
    throw new ClassPortalKeyError('CLASS_PORTAL_HMAC_KEY must hold 32 bytes');
  }
  return key;
}

const hmacHex = (key: Buffer, message: string) =>
  createHmac('sha256', key).update(message, 'utf8').digest('hex');

/** The device's key for the device throttle (64 hex characters). */
export function deviceKey(cookieValue: string, key: Buffer): string {
  return hmacHex(key, `class-device:${cookieValue}`);
}

/** The network's key for the per-network throttle of typed codes (64 hex characters). */
export function networkKey(prefix: string, key: Buffer): string {
  return hmacHex(key, `class-net:${prefix}`);
}
