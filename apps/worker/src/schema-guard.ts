/**
 * The worker refuses to start on a database without this release's migrations (DECISIONS D-114;
 * Phase 6 slice S3b writes it): every migration file shipped with it (14-digit prefix, from
 * `supabase/migrations`) must be in `supabase_migrations.schema_migrations`, or in
 * `lite_stack.schema_migrations` on the local lite stack.
 *
 * Returns the versions missing from the database (`index.ts` then exits 1 with a plain message:
 * run `migrate`). Finds none until S3b fills it.
 */
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface SchemaGuardContext {
  pool: Pick<Pool, 'query'>;
  logger: Logger;
}

export async function checkSchema(_ctx: SchemaGuardContext): Promise<string[]> {
  return [];
}
