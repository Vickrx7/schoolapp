/**
 * The worker refuses to start on a database without this release's migrations (DECISIONS D-114):
 * every migration file shipped with it (`supabase/migrations`, a 14-digit version and a name)
 * must be recorded in `supabase_migrations.schema_migrations` (the Supabase CLI's table, written
 * by `migrate`), or in `lite_stack.schema_migrations` on the local lite stack. A database that
 * has more migrations than the worker (an older image after a rollback) is not refused.
 *
 * `checkSchema` returns the names of the missing migrations (`index.ts` then exits 1 with a plain
 * message: run `migrate`). Names rather than bare versions, because the logger scrubs long digit
 * runs: the line still says which migrations are missing (`[nombre]_audit_retention`).
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { Logger } from './logger';

/** `supabase/migrations` of the checkout or image this worker runs from. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../supabase/migrations/', import.meta.url),
);

const MIGRATION_FILE = /^(\d{14})_[^/]+\.sql$/;

/** The migrations in a directory listing, by name (`20261201090200_audit_retention`), in order. */
export function shippedMigrations(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => MIGRATION_FILE.test(name))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

/**
 * The shipped migrations the database has not recorded, compared by their 14-digit version (the
 * CLI records the version, the lite stack the whole name).
 */
export function missingMigrations(
  shipped: readonly string[],
  applied: readonly string[],
): string[] {
  const done = new Set(applied.map((version) => version.slice(0, 14)));
  return shipped.filter((name) => !done.has(name.slice(0, 14)));
}

/** Each table that records applied migrations, when it exists. */
const MIGRATION_TABLES = [
  'supabase_migrations.schema_migrations',
  'lite_stack.schema_migrations',
] as const;

/** The versions (or names) the database recorded, from every migration table it has. */
export async function appliedMigrations(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    'select name from unnest($1::text[]) as t(name) where to_regclass(name) is not null',
    [MIGRATION_TABLES],
  );
  if (rows.length === 0) return [];
  // Only names from the fixed list above reach the query text.
  const tables = MIGRATION_TABLES.filter((table) => rows.some((row) => row.name === table));
  const { rows: applied } = await pool.query<{ version: string }>(
    tables.map((table) => `select version::text as version from ${table}`).join(' union '),
  );
  return applied.map((row) => row.version);
}

export interface SchemaGuardContext {
  pool: Pick<Pool, 'query'>;
  logger: Logger;
  /** Where the shipped migrations are (tests); `supabase/migrations` by default. */
  migrationsDir?: string;
}

export async function checkSchema(ctx: SchemaGuardContext): Promise<string[]> {
  const shipped = shippedMigrations(await readdir(ctx.migrationsDir ?? MIGRATIONS_DIR));
  if (shipped.length === 0) {
    // An image without its migrations cannot vouch for the database: refuse rather than guess.
    throw new Error('no migration files found next to the worker (supabase/migrations)');
  }
  const missing = missingMigrations(shipped, await appliedMigrations(ctx.pool));
  if (missing.length === 0)
    ctx.logger.info('database schema checked', { migrations: shipped.length });
  return missing;
}
