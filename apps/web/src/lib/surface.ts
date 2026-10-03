/**
 * Which surface a request belongs to (DECISIONS D-090): `jouer`, the student devices of
 * « Quiz sur les appareils » (/jouer), or `app`, everything else. `proxy.ts` always sets the
 * header, overwriting whatever a client sent; `i18n/request.ts` then serves the student surface
 * in French with only the `classPortal` messages, so no staff catalogue reaches a device.
 */
export const SURFACE_HEADER = 'x-lynx-surface';

export type Surface = 'jouer' | 'app';

export const JOUER_PATH = '/jouer';

export function surfaceOf(path: string): Surface {
  return path === JOUER_PATH || path.startsWith(`${JOUER_PATH}/`) ? 'jouer' : 'app';
}
