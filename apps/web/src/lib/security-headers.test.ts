import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  headerRules,
  NOT_PDF_SOURCE,
  PORTAL_HEADERS,
  securityHeaders,
} from './security-headers';

// Next turns each rule's `source` into the regular expression it matches at run time with this
// function (routes-manifest.json): the test uses the same one.
const require = createRequire(import.meta.url);
const { buildCustomRoute } = require('next/dist/lib/build-custom-route.js') as {
  buildCustomRoute: (type: 'header', route: { source: string }) => { regex: string };
};
const matches = (source: string, path: string) =>
  new RegExp(buildCustomRoute('header', { source }).regex).test(path);

/** Which headers Next sends for a path: later rules override earlier ones. */
function headersFor(path: string, production: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of headerRules({ production })) {
    if (matches(rule.source, path)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

describe('security headers (D-119)', () => {
  it('has the production policy, and none in development', () => {
    const production = securityHeaders({ production: true });
    expect(production).toContainEqual({
      key: 'Content-Security-Policy',
      value: CONTENT_SECURITY_POLICY,
    });
    expect(production).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    const development = securityHeaders({ production: false });
    expect(development.map((h) => h.key)).not.toContain('Content-Security-Policy');
    expect(development).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });

  it('allows the app itself only', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*|unsafe-eval/);
  });

  it('sends the policy on every page family, but not on PDFs', () => {
    for (const path of [
      '/',
      '/login',
      '/today',
      '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/planning',
      '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/planning/year',
      '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/planning/coverage',
      '/suppleance',
      '/suppleance/plan',
      '/s',
      '/jouer',
      '/jouer/partie',
      '/projector/sessions/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b',
      '/api/health',
      '/library/pdf-guide',
      '/pdfs',
    ]) {
      expect(headersFor(path, true)['Content-Security-Policy'], path).toBe(CONTENT_SECURITY_POLICY);
      expect(headersFor(path, true)['X-Robots-Tag'], path).toBe('noindex, nofollow');
    }
    for (const path of [
      '/suppleance/pdf',
      '/absences/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/plans/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f/pdf',
      '/library/items/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/pdf',
      // « Plan à long terme » (D-127).
      '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/planning/year/pdf',
    ]) {
      const headers = headersFor(path, true);
      expect(headers['Content-Security-Policy'], path).toBeUndefined();
      expect(headers['X-Content-Type-Options'], path).toBe('nosniff');
      expect(headers['X-Frame-Options'], path).toBe('DENY');
    }
    expect(matches(NOT_PDF_SOURCE, '/login')).toBe(true);
  });

  it('keeps the portal overrides', () => {
    for (const path of ['/suppleance', '/suppleance/pdf', '/s', '/jouer', '/jouer/api/state']) {
      const headers = headersFor(path, true);
      for (const h of PORTAL_HEADERS) expect(headers[h.key], `${path} ${h.key}`).toBe(h.value);
    }
    expect(headersFor('/today', true)['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headersFor('/today', true)['Cache-Control']).toBeUndefined();
  });
});
