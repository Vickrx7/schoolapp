import 'server-only';
import { scrubError } from '@lynx/observability';
import { serverEnv } from '../env';
import { webLogger } from '../observability';
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
      webLogger.error('setting unusable', { context: 'classPortalHmacKey', error: scrubError(e) });
    }
    return null;
  }
}
