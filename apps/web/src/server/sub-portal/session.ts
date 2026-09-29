import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverEnv } from '../env';
import { subPortalConfigured } from './db';
import { loadDay, type PortalDay, type PortalPurpose } from './portal';

/**
 * The substitute's browser (DECISIONS D-050): an HttpOnly session cookie holding the token
 * from sub_portal.redeem, and a device cookie (32 random bytes, kept a year) whose hash is the
 * device for the two-device limit and throttling. Both are limited to /suppleance, SameSite=Lax,
 * and Secure with the __Secure- prefix when the app is served over https. Staff cookies are
 * never read on portal paths (proxy.ts), and these never reach staff pages.
 */

const PORTAL_PATH = '/suppleance';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE = /^[A-Za-z0-9_-]{43}$/;
const ONE_YEAR = 60 * 60 * 24 * 365;

const secure = () => serverEnv().APP_BASE_URL.startsWith('https:');
const sessionCookie = () => (secure() ? '__Secure-lynx_sub' : 'lynx_sub');
const deviceCookie = () => (secure() ? '__Secure-lynx_sub_device' : 'lynx_sub_device');

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secure(),
  path: PORTAL_PATH,
});

/** The session token in this browser, if it looks like one. */
export async function readSubToken(): Promise<string | null> {
  const value = (await cookies()).get(sessionCookie())?.value;
  return value && TOKEN.test(value) ? value : null;
}

/** Keeps a new session on this device until it expires (server actions only). */
export async function setSubSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(sessionCookie(), token, { ...cookieOptions(), expires: expiresAt });
}

/** Forgets the session on this device (server actions and route handlers only). */
export async function clearSubSessionCookie(): Promise<void> {
  (await cookies()).set(sessionCookie(), '', { ...cookieOptions(), maxAge: 0 });
}

/**
 * This device's id, created on its first code attempt (server actions only). A browser that
 * refuses cookies gets a new id each time and is throttled per network instead.
 */
export async function subDeviceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(deviceCookie())?.value;
  if (existing && DEVICE.test(existing)) return existing;
  const id = randomBytes(32).toString('base64url');
  store.set(deviceCookie(), id, { ...cookieOptions(), maxAge: ONE_YEAR });
  return id;
}

/**
 * The substitute's day for a portal page. No session: back to « Accès suppléance ». A session
 * that ended (cut by the office, expired, absence cancelled): through /suppleance/ended, which
 * forgets the cookie and says so.
 */
export async function requireSubDay(purpose: Exclude<PortalPurpose, 'pdf'>): Promise<PortalDay> {
  if (!subPortalConfigured()) redirect(PORTAL_PATH);
  const token = await readSubToken();
  if (!token) redirect(PORTAL_PATH);
  const day = await loadDay(token, null, purpose);
  if (!day) redirect(`${PORTAL_PATH}/ended`);
  return day;
}
