/**
 * The class portal's connection settings (DECISIONS D-083), apart from `db.ts` so the integration
 * test opens its pool with exactly these. The limits are set by the client, on every connection:
 * they also hold under the CI fallback (`postgres` with `-c role=lynx_class_portal`), where the
 * role's own `statement_timeout` does not apply.
 */
export const CLASS_PORTAL_POOL_OPTIONS = {
  /** A class polls about 20 times a second; portal calls take a few milliseconds each. */
  max: 5,
  /** A portal call that runs longer is cut (the device retries on its next poll). */
  statement_timeout: 3000,
  /** No connection within 2 s: the call fails fast instead of piling up. */
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10_000,
  application_name: 'lynx-class-portal',
} as const;
