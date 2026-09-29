import 'server-only';
import { serverEnv } from '../env';
import { classPortalKey } from './crypto';

let reported = false;

/**
 * The throttle key from CLASS_PORTAL_HMAC_KEY, or null when it is missing or invalid: quizzes on
 * devices are then off (D-083). A bad setting is logged once (never the value).
 */
export function classPortalHmacKey(): Buffer | null {
  try {
    return classPortalKey(serverEnv().CLASS_PORTAL_HMAC_KEY);
  } catch (e) {
    if (!reported) {
      reported = true;
      console.error(
        JSON.stringify({
          level: 'error',
          context: 'classPortalHmacKey',
          message: (e as Error).message,
        }),
      );
    }
    return null;
  }
}
