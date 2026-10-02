import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appliedMigrations,
  checkSchema,
  MIGRATIONS_DIR,
  missingMigrations,
  shippedMigrations,
} from './schema-guard';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A pool whose database has the given migration tables, each with its recorded versions. */
function poolWith(tables: Record<string, string[]>) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (params) {
      const names = params[0] as string[];
      return { rows: names.filter((name) => name in tables).map((name) => ({ name })) };
    }
    const rows = Object.entries(tables)
      .filter(([table]) => sql.includes(`from ${table}`))
      .flatMap(([, versions]) => versions.map((version) => ({ version })));
    return { rows };
  });
  return { query } as unknown as Parameters<typeof appliedMigrations>[0] & {
    query: typeof query;
  };
}

describe('shippedMigrations', () => {
  it('keeps migration files only, by name and in order', () => {
    expect(
      shippedMigrations([
        '20261201090100_pilot_accounts.sql',
        'README.md',
        '20260928160000_foundation.sql',
        '2026120109_short.sql',
        '20261201090200_audit_retention.sql.bak',
      ]),
    ).toEqual(['20260928160000_foundation', '20261201090100_pilot_accounts']);
  });

  it('finds every file the repository ships', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(30);
    expect(shippedMigrations(files)).toHaveLength(files.length);
  });
});

describe('missingMigrations (D-114)', () => {
  const shipped = ['20260928160000_foundation', '20261201090200_audit_retention'];

  it('compares by the 14-digit version, whichever table recorded it', () => {
    // The Supabase CLI records versions, the lite stack whole names.
    expect(missingMigrations(shipped, ['20260928160000', '20261201090200'])).toEqual([]);
    expect(missingMigrations(shipped, shipped)).toEqual([]);
    expect(missingMigrations(shipped, ['20260928160000'])).toEqual([
      '20261201090200_audit_retention',
    ]);
    expect(missingMigrations(shipped, [])).toEqual(shipped);
  });

  it('does not refuse a database that is ahead of the worker', () => {
    expect(missingMigrations(shipped, [...shipped, '20991231000000'])).toEqual([]);
  });
});

describe('appliedMigrations', () => {
  it('reads every migration table the database has, and none it lacks', async () => {
    expect(await appliedMigrations(poolWith({}))).toEqual([]);
    expect(
      await appliedMigrations(
        poolWith({
          'supabase_migrations.schema_migrations': ['20260928160000'],
          'lite_stack.schema_migrations': ['20261201090200_b'],
        }),
      ),
    ).toEqual(['20260928160000', '20261201090200_b']);
  });
});

describe('checkSchema', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function migrationsDir(...names: string[]): Promise<string> {
    dir = await mkdtemp(path.join(tmpdir(), 'schema-guard-'));
    for (const name of names) await writeFile(path.join(dir, name), '-- test\n');
    return dir;
  }

  it('reads the CLI’s table on Supabase and the lite stack’s locally', async () => {
    const migrationsDirPath = await migrationsDir('20260928160000_a.sql', '20261201090200_b.sql');
    const cli = poolWith({
      'supabase_migrations.schema_migrations': ['20260928160000', '20261201090200'],
    });
    expect(
      await checkSchema({ pool: cli, logger: logger(), migrationsDir: migrationsDirPath }),
    ).toEqual([]);
    const lite = poolWith({ 'lite_stack.schema_migrations': ['20260928160000_a'] });
    expect(
      await checkSchema({ pool: lite, logger: logger(), migrationsDir: migrationsDirPath }),
    ).toEqual(['20261201090200_b']);
  });

  it('counts a migration recorded in either table when both exist', async () => {
    const migrationsDirPath = await migrationsDir('20260928160000_a.sql', '20261201090200_b.sql');
    const both = poolWith({
      'supabase_migrations.schema_migrations': ['20260928160000'],
      'lite_stack.schema_migrations': ['20261201090200_b'],
    });
    expect(
      await checkSchema({ pool: both, logger: logger(), migrationsDir: migrationsDirPath }),
    ).toEqual([]);
  });

  it('finds every migration missing from a database that was never migrated', async () => {
    const migrationsDirPath = await migrationsDir('20260928160000_a.sql');
    const empty = poolWith({});
    expect(
      await checkSchema({ pool: empty, logger: logger(), migrationsDir: migrationsDirPath }),
    ).toEqual(['20260928160000_a']);
    // No second query when there is no table to read.
    expect(empty.query).toHaveBeenCalledTimes(1);
  });

  it('refuses to vouch for a database when no migration ships with the worker', async () => {
    const migrationsDirPath = await migrationsDir('notes.txt');
    await expect(
      checkSchema({ pool: poolWith({}), logger: logger(), migrationsDir: migrationsDirPath }),
    ).rejects.toThrow(/no migration files/);
  });
});
