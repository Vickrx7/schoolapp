import 'server-only';
import pg from 'pg';
import { serverEnv } from '../env';

/**
 * The substitute portal's own database connection (DECISIONS D-049). Substitutes have no
 * account: the web server calls the sub_portal functions for them as lynx_sub_portal, a role
 * that can run those functions and nothing else. This connection never carries a staff session,
 * and staff pages never use it. A small pool: portal calls are short.
 */

export class SubPortalNotConfiguredError extends Error {}

// Kept on globalThis so development reloads do not open a new pool each time.
const holder = globalThis as unknown as { lynxSubPortalPool?: pg.Pool };

/** Whether this server has a portal connection (SUB_PORTAL_DATABASE_URL). */
export function subPortalConfigured(): boolean {
  return Boolean(serverEnv().SUB_PORTAL_DATABASE_URL);
}

function pool(): pg.Pool {
  const url = serverEnv().SUB_PORTAL_DATABASE_URL;
  if (!url) throw new SubPortalNotConfiguredError('SUB_PORTAL_DATABASE_URL is not set');
  if (!holder.lynxSubPortalPool) {
    const created = new pg.Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      // The role has the same limit; this also covers a fallback connection that SETs the role.
      statement_timeout: 5_000,
      application_name: 'lynx-sub-portal',
    });
    // A connection dropped while idle must not take the web server down.
    created.on('error', (err) => {
      console.error(
        JSON.stringify({ level: 'error', context: 'subPortalPool', message: err.message }),
      );
    });
    holder.lynxSubPortalPool = created;
  }
  return holder.lynxSubPortalPool;
}

/** Runs one parameterized statement as the portal role. */
export async function portalQuery<R extends pg.QueryResultRow>(
  text: string,
  values: unknown[],
): Promise<R[]> {
  const { rows } = await pool().query<R>(text, values);
  return rows;
}
