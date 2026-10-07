import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { appliedMigrations, checkSchema } from './schema-guard';

/**
 * The schema guard (D-114) against the real database: the lite stack records its migrations in
 * `lite_stack.schema_migrations`, the Supabase CLI (CI) in `supabase_migrations.schema_migrations`;
 * either way a migrated database lets the worker start.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
afterAll(() => pool.end());

describe('schema guard', () => {
  it('finds every shipped migration in a migrated database', async () => {
    expect((await appliedMigrations(pool)).length).toBeGreaterThan(30);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(await checkSchema({ pool, logger })).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith('database schema checked', {
      migrations: expect.any(Number),
    });
  });
});
