import 'server-only';
import type { KeyRing } from '../alerts-crypto';
import { serverEnv } from '../env';
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
      console.error(
        JSON.stringify({ level: 'error', context: 'subCodeKeys', message: (e as Error).message }),
      );
    }
    return null;
  }
}
