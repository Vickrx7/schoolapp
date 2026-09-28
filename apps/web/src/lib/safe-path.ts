/**
 * Only allow redirects to paths on this site (no open redirects).
 * Resolves the value against a dummy origin and rejects anything that would leave it,
 * including tricks like "/\t/evil.example" (browsers strip tabs and newlines in URLs).
 */
export function safeNextPath(next: string | null | undefined): string {
  const fallback = '/today';
  if (!next || !next.startsWith('/') || hasUnsafeCharacter(next)) return fallback;
  try {
    const base = 'http://safe.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Control characters (which browsers strip) and backslashes (which they treat as "/"). */
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}
