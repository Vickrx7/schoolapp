import 'server-only';
import type { KeyRing } from '../alerts-crypto';
import { scrubError } from '@lynx/observability';
import { serverEnv } from '../env';
import { webLogger } from '../observability';
import { subCodeRing } from './crypto';

let reported = false;

/**
 * The code key ring from SUB_CODE_HMAC_KEYS, or null when it is missing or invalid: codes then
 * cannot be issued or used. A bad setting is logged once (never the value).
 */
export function subCodeKeys(): KeyRing | null {
  try {
    return subCodeRing(serverEnv().SUB_CODE_HMAC_KEYS);
  } catch (e) {
    if (!reported) {
      reported = true;
      webLogger.error('setting unusable', { context: 'subCodeKeys', error: scrubError(e) });
    }
    return null;
  }
}
