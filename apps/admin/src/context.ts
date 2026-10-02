/**
 * What every admin command gets: the parsed options, the settings and a service-role database
 * client, plus the small helpers the commands share. The environment is read and the client
 * created only when a command first uses them, so listing the commands, the commands that are not
 * available yet and the unit tests need neither.
 */
import path from 'node:path';
import { loadEnv, adminEnvSchema, type AdminEnv } from '@lynx/config';
import type { Database } from '@lynx/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CliOption, CliValues } from './args';

/** A failure the operator can act on: printed as « Error: … » without a stack trace. */
export class CliError extends Error {}

export interface CliContext {
  values: CliValues;
  env: AdminEnv;
  /** Service role: bypasses row level security. Only from a trusted machine. */
  db: SupabaseClient<Database>;
}

/** An admin command: what it prints on success. */
export type Command = (ctx: CliContext) => Promise<string>;

/** The settings are read, and the client created, the first time a command asks for them. */
export function createContext(values: CliValues): CliContext {
  let env: AdminEnv | undefined;
  let db: SupabaseClient<Database> | undefined;
  return {
    values,
    get env() {
      env ??= loadEnv(adminEnvSchema);
      return env;
    },
    get db() {
      db ??= createClient<Database>(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return db;
    },
  };
}

/** A required string option, trimmed. */
export function need(ctx: CliContext, key: CliOption): string {
  const v = ctx.values[key];
  if (typeof v !== 'string' || v.trim() === '') throw new CliError(`--${key} is required`);
  return v.trim();
}

/** An optional `true`/`false` option. */
export function bool(ctx: CliContext, key: CliOption): boolean | undefined {
  const v = ctx.values[key];
  if (v === undefined) return undefined;
  if (v !== 'true' && v !== 'false') throw new CliError(`--${key} must be true or false`);
  return v === 'true';
}

/** An optional amount (zero or more). */
export function amount(ctx: CliContext, key: CliOption): number | undefined {
  const v = ctx.values[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new CliError(`--${key} must be a positive number`);
  return n;
}

/** The row of a query that must find one, or a readable error. */
export function check<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  if (result.error) throw new CliError(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new CliError(`${what}: not found`);
  return result.data as NonNullable<T>;
}

/**
 * The account an e-mail address belongs to: its profile, else an Auth account without one (an
 * interrupted invitation); null when there is none. The address travels in the body of the
 * `operator_account_id` call, never in a URL: PostgREST puts filters in the query string, and
 * the hosted API gateway's logs record URLs (DECISIONS D-119). Commands then name the person by
 * id only.
 */
export async function accountIdByEmail(ctx: CliContext, email: string): Promise<string | null> {
  const { data, error } = await ctx.db.rpc('operator_account_id', { p_email: email });
  if (error) throw new CliError(`find ${email}: ${error.message}`);
  return data ?? null;
}

export async function boardBySlug(ctx: CliContext, slug: string) {
  return check(
    await ctx.db.from('boards').select('id, name').eq('slug', slug).maybeSingle(),
    `board "${slug}"`,
  );
}

/** "board-slug/school-slug" */
export async function schoolByPath(ctx: CliContext, path: string) {
  const [boardSlug, schoolSlug] = path.split('/');
  if (!boardSlug || !schoolSlug)
    throw new CliError('--school must look like board-slug/school-slug');
  const board = await boardBySlug(ctx, boardSlug);
  const school = check(
    await ctx.db
      .from('schools')
      .select('id, name, board_id')
      .eq('board_id', board.id)
      .eq('slug', schoolSlug)
      .maybeSingle(),
    `school "${path}"`,
  );
  return { board, school };
}

export const money = (n: number) => `${n.toFixed(2)} USD`;

/** A path the operator typed, from where the command was typed (pnpm runs in apps/admin). */
export function operatorPath(given: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
}

export function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Writes rows 500 at a time; each call is one statement. */
export async function inChunks<T>(
  rows: readonly T[],
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
  what: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await write(rows.slice(i, i + 500));
    if (error) throw new CliError(`${what}: ${error.message}`);
  }
}

/**
 * The answer of a command whose Phase 5 slice has not landed yet (« pas encore disponible »):
 * it fails, so a script never mistakes it for a success.
 */
export function notYetAvailable(command: string): never {
  throw new CliError(`${command} : pas encore disponible (not available yet).`);
}
