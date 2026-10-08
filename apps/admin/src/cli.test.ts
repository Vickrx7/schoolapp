/**
 * `pnpm admin` refuses an invalid OPERATOR_NAME before any command starts (DECISIONS D-148). Run
 * as the operator runs it, without the database's settings: a command that started would fail on
 * those instead.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function admin(operatorName: string) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'apps/admin/src/cli.ts',
      'log-operator-access',
      '--board',
      'csc-x',
      '--reason',
      'support',
    ],
    {
      cwd: ROOT,
      env: { PATH: process.env.PATH, OPERATOR_NAME: operatorName },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

describe('pnpm admin and OPERATOR_NAME (D-148)', () => {
  it('stops before the command when the name is invalid, and goes on when it is valid', () => {
    for (const name of ['x'.repeat(81), '   ', 'IP‮Lynx']) {
      const run = admin(name);
      expect(run.status, JSON.stringify(name)).toBe(1);
      expect(run.stderr).toMatch(/OPERATOR_NAME/);
      // The command never asked for its settings.
      expect(run.stderr).not.toMatch(/SUPABASE/);
    }
    // A valid name: the command starts, then stops for the database settings this test lacks.
    const run = admin('Équipe TI — Conseil d’Exemple');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/SUPABASE_URL/);
    expect(run.stderr).not.toMatch(/OPERATOR_NAME/);
  }, 60_000);
});
