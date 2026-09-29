import 'server-only';
import pg from 'pg';
import { serverEnv } from '../env';
import { createGate, createNegativeCache, type GateResult } from './gate';
import { classPortalHmacKey } from './keys';
import { CLASS_PORTAL_POOL_OPTIONS } from './pool-options';

/**
 * Class devices' own database connection (DECISIONS D-083). Students have no account: the web
 * server calls the class_portal functions for them as lynx_class_portal, a role that can run
 * those five functions and nothing else. This connection never carries a staff session, and
 * staff pages never use it. Every call goes through the gate (5 running, 50 waiting, then
 * `busy`), so a burst of polls answers 503 instead of piling up behind the pool.
 */

export class ClassPortalNotConfiguredError extends Error {}

// Kept on globalThis so development reloads do not open a new pool (or gate) each time.
const holder = globalThis as unknown as {
  lynxClassPortalPool?: pg.Pool;
  lynxClassPortalGate?: ReturnType<typeof createGate>;
  lynxClassPortalGone?: ReturnType<typeof createNegativeCache>;
};

/**
 * Whether this server runs quizzes on devices: a portal connection (CLASS_PORTAL_DATABASE_URL)
 * and a valid throttle key (CLASS_PORTAL_HMAC_KEY). Without them « Présenter » still works.
 */
export function classPortalConfigured(): boolean {
  return Boolean(serverEnv().CLASS_PORTAL_DATABASE_URL) && classPortalHmacKey() !== null;
}

function pool(): pg.Pool {
  const url = serverEnv().CLASS_PORTAL_DATABASE_URL;
  if (!url) throw new ClassPortalNotConfiguredError('CLASS_PORTAL_DATABASE_URL is not set');
  if (!holder.lynxClassPortalPool) {
    const created = new pg.Pool({ connectionString: url, ...CLASS_PORTAL_POOL_OPTIONS });
    // A connection dropped while idle must not take the web server down.
    created.on('error', (err) => {
      console.error(
        JSON.stringify({ level: 'error', context: 'classPortalPool', message: err.message }),
      );
    });
    holder.lynxClassPortalPool = created;
  }
  return holder.lynxClassPortalPool;
}

const gate = () => (holder.lynxClassPortalGate ??= createGate());

/**
 * Device tokens (their SHA-256, never the token) the database called gone in the last minute:
 * a flood of random tokens never reaches the database (D-083).
 */
export const goneTokens = () => (holder.lynxClassPortalGone ??= createNegativeCache());

/**
 * Runs one parameterized statement as the portal role, when a turn is free; `busy` when too many
 * calls already wait. Values are passed as parameters only; nothing is logged.
 */
export async function portalQuery<R extends pg.QueryResultRow>(
  text: string,
  values: unknown[],
): Promise<GateResult<R[]>> {
  const connection = pool();
  return gate().run(async () => (await connection.query<R>(text, values)).rows);
}
