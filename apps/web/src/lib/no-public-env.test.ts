/**
 * DECISIONS D-113: the web app reads its settings on the server at run time, so no
 * `NEXT_PUBLIC_*` name may appear in `apps/web/src` (Next would build its value into the app).
 * eslint.config.mjs forbids it; this test pins that the rule stays on for every spelling.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

async function violations(filePath: string, code: string): Promise<number> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('no NEXT_PUBLIC_ settings in the web app (D-113)', () => {
  it('refuses every spelling, in server and browser code', async () => {
    for (const file of [
      'apps/web/src/server/probe.ts',
      'apps/web/src/components/probe.tsx',
      'apps/web/src/app/probe/page.tsx',
    ]) {
      for (const code of [
        'export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;\n',
        "export const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];\n",
        'export const url = process.env[`NEXT_PUBLIC_APP_NAME`];\n',
        'const { NEXT_PUBLIC_APP_NAME } = process.env;\nexport const name = NEXT_PUBLIC_APP_NAME;\n',
      ]) {
        expect(await violations(file, code), `${file}: ${code}`).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('allows the run-time names', async () => {
    expect(
      await violations(
        'apps/web/src/server/probe.ts',
        "import { serverEnv } from './env';\nexport const url = serverEnv().SUPABASE_URL;\n" +
          '// NEXT_PUBLIC_SUPABASE_URL is the old name (a comment is fine).\n',
      ),
    ).toBe(0);
  }, 60_000);
});
