import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverEnv } from '../env';
import { CLASS_LINK_PATTERN } from './code';

/**
 * A class device's browser (DECISIONS D-084): no account, two cookies, both limited to /jouer,
 * HttpOnly, SameSite=Lax, and Secure with the __Secure- prefix when the app is served over https:
 *
 * - the device token from `class_portal.join` (`lynx_jouer`), 32 random bytes the database
 *   stores only as a SHA-256, kept until the session's expiry;
 * - the device cookie (`lynx_jouer_device`), 32 random bytes kept 30 days, whose HMAC is the
 *   device for throttling (`crypto.ts`) and gives a device that joins again its number back.
 *
 * Staff cookies are never read on /jouer (proxy.ts returns before the Supabase client exists),
 * and these never reach staff pages (their path is /jouer). Nothing is kept in the browser's
 * storage: what a student types stays in the page (D-088).
 */

const JOUER_PATH = '/jouer';
/** Both cookies hold 32 random bytes in base64url (43 characters). */
const RANDOM_43 = CLASS_LINK_PATTERN;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const secure = () => serverEnv().APP_BASE_URL.startsWith('https:');
const tokenCookie = () => (secure() ? '__Secure-lynx_jouer' : 'lynx_jouer');
const deviceCookie = () => (secure() ? '__Secure-lynx_jouer_device' : 'lynx_jouer_device');

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secure(),
  path: JOUER_PATH,
});

/** This device's token, if it has one that looks like one. */
export async function readDeviceToken(): Promise<string | null> {
  const value = (await cookies()).get(tokenCookie())?.value;
  return value && RANDOM_43.test(value) ? value : null;
}

/** Keeps the device in its session until the session expires (route handlers only). */
export async function setDeviceTokenCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(tokenCookie(), token, { ...cookieOptions(), expires: expiresAt });
}

/** Forgets the session on this device (route handlers only). */
export async function clearDeviceTokenCookie(): Promise<void> {
  (await cookies()).set(tokenCookie(), '', { ...cookieOptions(), maxAge: 0 });
}

/**
 * This device's cookie, created on its first join (route handlers only). A browser that refuses
 * cookies gets a new one each time: it is then throttled per network for typed codes.
 */
export async function deviceCookieValue(): Promise<string> {
  const store = await cookies();
  const existing = store.get(deviceCookie())?.value;
  if (existing && RANDOM_43.test(existing)) return existing;
  const value = randomBytes(32).toString('base64url');
  store.set(deviceCookie(), value, { ...cookieOptions(), maxAge: THIRTY_DAYS });
  return value;
}

/** The device token for a game page, or back to « Rejoindre la partie » without one. */
export async function requireDevice(): Promise<string> {
  const token = await readDeviceToken();
  if (!token) redirect(JOUER_PATH);
  return token;
}
