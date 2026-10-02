import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { headerRules } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
  // Security headers and the portals' rules (src/lib/security-headers.ts, DECISIONS D-119): the
  // Content Security Policy is built into production builds only.
  async headers() {
    return headerRules({ production: process.env.NODE_ENV === 'production' });
  },
};

export default withNextIntl(nextConfig);
