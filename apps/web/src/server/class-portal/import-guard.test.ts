/**
 * Guard 3 of D-086 (DECISIONS D-083, D-086): the device pages, their components and the class
 * portal's server code may not import a Supabase client, the staff session, the library's queries
 * or actions, or the AI package. eslint.config.mjs forbids it; this test pins that the rule stays
 * on for each of those paths, with the relative and aliased spellings.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const FORBIDDEN = [
  "import { requireSession } from '@/server/session';",
  "import { createSupabaseServerClient } from '@/server/supabase';",
  "import { loadLibraryItem } from '@/server/queries/library';",
  "import { remixItem } from '@/server/actions/library-growth';",
  "import { runFeature } from '@lynx/ai';",
  "import { findPersonalInfo } from '@lynx/ai/privacy';",
  "import { createServerClient } from '@supabase/ssr';",
];

async function restrictedImports(filePath: string, code: string): Promise<number> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
}

describe('class device code cannot reach staff data or AI (D-086, guard 3)', () => {
  it('refuses every forbidden import in the portal server code, pages and components', async () => {
    for (const file of [
      'apps/web/src/server/class-portal/probe.ts',
      'apps/web/src/app/jouer/probe/page.tsx',
      'apps/web/src/components/class-portal/probe.tsx',
    ]) {
      for (const line of FORBIDDEN) {
        expect(await restrictedImports(file, `${line}\n`), `${file}: ${line}`).toBe(1);
      }
    }
    // Relative spellings from the portal's server code.
    expect(
      await restrictedImports(
        'apps/web/src/server/class-portal/probe.ts',
        "import { requireSession } from '../session';\nimport { x } from '../queries/library';\n",
      ),
    ).toBe(2);
  }, 60_000);

  it('allows what the portal needs', async () => {
    expect(
      await restrictedImports(
        'apps/web/src/server/class-portal/probe.ts',
        "import { serverEnv } from '../env';\nimport { createGate } from './gate';\n" +
          "import { clientIp } from '../sub-portal/client-ip';\n",
      ),
    ).toBe(0);
  }, 60_000);
});
