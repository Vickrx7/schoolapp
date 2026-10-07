/**
 * DECISIONS D-119: no personal value in an API query string. PostgREST puts a filter's value in
 * the URL and the hosted API gateway's logs record URLs, so code may not filter on an e-mail or
 * a name, nor use pattern or full-text filters; lookups go in an RPC body. eslint.config.mjs
 * forbids it in every app and package; this test pins that the rule stays on, next to the
 * NEXT_PUBLIC_ one it shares the web app's `no-restricted-syntax` with.
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

const FILES = [
  'apps/web/src/server/probe.ts',
  'apps/admin/src/commands/probe.ts',
  'apps/worker/src/probe.ts',
  'packages/domain/src/probe.ts',
];

describe('no personal value in a PostgREST query string (D-119)', () => {
  it('refuses filters on addresses and names, and pattern or full-text filters', async () => {
    for (const file of FILES) {
      for (const code of [
        "export const q = (db: any, e: string) => db.from('users').select('id').eq('email', e);\n",
        "export const q = (db: any, e: string[]) => db.from('users').select('id').in('email', e);\n",
        "export const q = (db: any, n: string) => db.from('students').select('id').eq('first_name', n);\n",
        "export const q = (db: any, n: string) => db.from('users').select('id').filter('display_name', 'eq', n);\n",
        "export const q = (db: any, t: string) => db.from('library_items').select('id').ilike('title', t);\n",
        "export const q = (db: any, t: string) => db.from('library_items').select('id').textSearch('search_document', t);\n",
        "export const q = (db: any, e: string) => db.from('users').select('id').or(`email.eq.${e},id.is.null`);\n",
        "export const q = (db: any) => db.from('users').select('id').or('id.is.null,display_name.eq.Léa');\n",
      ]) {
        expect(await violations(file, code), `${file}: ${code}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('allows ids and request bodies', async () => {
    for (const file of FILES) {
      expect(
        await violations(
          file,
          'export const q = (db: any, id: string, e: string) => Promise.all([\n' +
            "  db.from('users').select('id, email').eq('id', id),\n" +
            "  db.rpc('operator_account_id', { p_email: e }),\n" +
            "  db.from('library_items').select('id').or('status.eq.board_approved,share_scope.eq.board'),\n" +
            ']);\n',
        ),
        file,
      ).toBe(0);
    }
  }, 120_000);

  it('keeps the web app’s NEXT_PUBLIC_ rule alongside it', async () => {
    expect(
      await violations(
        'apps/web/src/server/probe.ts',
        'export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;\n',
      ),
    ).toBeGreaterThan(0);
  }, 60_000);
});
