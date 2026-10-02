import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// The substitute portal (DECISIONS D-049): never cached, never sent as a referrer (the plan's
// address must not leak to a site a substitute follows a link to), never indexed. Later
// entries override the same header from the global list.
const portalHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (board-hosted installs).
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  transpilePackages: [
    '@lynx/domain',
    '@lynx/config',
    '@lynx/db',
    '@lynx/ai',
    '@lynx/content',
    '@lynx/observability',
  ],
  // Run from node_modules, not bundled: the portal's Postgres driver, and the PDF renderer
  // (DECISIONS D-053), which has its own React reconciler and loads its layout engine at runtime.
  serverExternalPackages: ['pg', '@react-pdf/renderer'],
  // The PDF routes read the vendored fonts from disk: copy them into the standalone build.
  outputFileTracingIncludes: { '/**/pdf': ['./assets/fonts/**'] },
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web; the repo keeps its
  // own contributor notes (docs/HANDOFF.md).
  agentRules: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/suppleance/:path*', headers: portalHeaders },
      { source: '/s', headers: portalHeaders },
      // Class devices (« Quiz sur les appareils », DECISIONS D-083 to D-090): the same rules. A
      // class link's token travels in the fragment (`/jouer#k=…`), which never reaches the
      // server, and the pages and the device API are never cached or indexed.
      { source: '/jouer', headers: portalHeaders },
      { source: '/jouer/:path*', headers: portalHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
