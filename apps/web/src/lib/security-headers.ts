/**
 * Response headers (DECISIONS D-119), used by `next.config.ts`. Pure, so it is unit tested.
 *
 * In production every page carries a Content Security Policy that allows the app's own scripts,
 * styles, fonts and requests only (no third-party script, tracker or analytics; the browser
 * never calls Supabase). Next's pages need inline scripts and styles (`'unsafe-inline'`). The
 * policy is left off in development, where Next's tools need more.
 *
 * PDF responses (`…/pdf`) get every header but the policy: a PDF opened in the browser is shown
 * by its viewer as a plugin document, which Chrome checks against the document's own
 * `object-src`, so `'none'` would leave the page blank.
 */

export interface Header {
  key: string;
  value: string;
}

export interface HeaderRule {
  source: string;
  headers: Header[];
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** The P-18 list (D-119): the policy in production only. */
export function securityHeaders({ production }: { production: boolean }): Header[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ...(production ? [{ key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }] : []),
  ];
}

/**
 * The substitute portal (DECISIONS D-049) and class devices (D-083 to D-090): never cached,
 * never sent as a referrer (the plan's address must not leak to a site a substitute follows a
 * link to), never indexed. Later rules override the same header from the global list.
 */
export const PORTAL_HEADERS: Header[] = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** Every path except PDF routes (a last segment `pdf`). */
export const NOT_PDF_SOURCE = '/:path((?!(?:.*/)?pdf$).*)';

/** The `headers()` rules of `next.config.ts`. */
export function headerRules({ production }: { production: boolean }): HeaderRule[] {
  const all = securityHeaders({ production });
  const policy = all.filter((h) => h.key === 'Content-Security-Policy');
  return [
    { source: '/:path*', headers: all.filter((h) => h.key !== 'Content-Security-Policy') },
    ...(policy.length > 0 ? [{ source: NOT_PDF_SOURCE, headers: policy }] : []),
    { source: '/suppleance/:path*', headers: PORTAL_HEADERS },
    { source: '/s', headers: PORTAL_HEADERS },
    // A class link's token travels in the fragment (`/jouer#k=…`), which never reaches the
    // server; the pages and the device API are never cached or indexed.
    { source: '/jouer', headers: PORTAL_HEADERS },
    { source: '/jouer/:path*', headers: PORTAL_HEADERS },
  ];
}
