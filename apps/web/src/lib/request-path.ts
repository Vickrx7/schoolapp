import { safeNextPath } from './safe-path';

/**
 * The page a request is for (path and query), set by `proxy.ts` on every request it forwards,
 * overwriting whatever a client sent. `requireSession()` reads it to send a person who has not
 * accepted the pilot terms to « Bienvenue » and back (DECISIONS D-109): server components have
 * no other way to know their address.
 */
export const REQUEST_PATH_HEADER = 'x-lynx-path';

/** « Bienvenue », the terms at a first sign-in. */
export const WELCOME_PATH = '/bienvenue';

/** Next's own query parameter on client navigations, never part of a page's address. */
const NEXT_INTERNAL = /^_rsc$/;

/** The path and query of a request, without Next's internal parameters. */
export function requestPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) if (NEXT_INTERNAL.test(key)) params.delete(key);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

const isWelcome = (path: string) =>
  path === WELCOME_PATH ||
  path.startsWith(`${WELCOME_PATH}/`) ||
  path.startsWith(`${WELCOME_PATH}?`);

/**
 * Where to go after « Bienvenue »: the page the person was on (a safe local path), never
 * « Bienvenue » itself; null when there is none (the person's landing page then).
 */
export function welcomeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const path = safeNextPath(next);
  // safeNextPath answers « /today » for anything unsafe: that is no page the person was on.
  const refused = path === '/today' && !/^\/today(?:[?#]|$)/.test(next);
  if (refused || isWelcome(path) || path === '/') return null;
  return path;
}

/** « Bienvenue », coming back to `path` afterwards. */
export function welcomeHref(path: string | null | undefined): string {
  const next = welcomeNext(path);
  return next ? `${WELCOME_PATH}?next=${encodeURIComponent(next)}` : WELCOME_PATH;
}
