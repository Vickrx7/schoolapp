/**
 * Environment configuration, validated with Zod. Every setting comes from environment
 * variables (documented in .env.example) so the same build runs hosted or board-hosted.
 */
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** The working product name (DECISIONS D-002), until a name is chosen. */
export const DEFAULT_APP_NAME = 'Lynx École';

/**
 * Names that replaced older ones (DECISIONS D-113): the web app reads its settings at run time
 * on the server, so nothing is `NEXT_PUBLIC_*` any more (Next inlined those into the build). The
 * old names are still read when the new one is unset, so an existing `.env` keeps working.
 */
export const LEGACY_ENV_NAMES = {
  SUPABASE_URL: 'NEXT_PUBLIC_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  APP_NAME: 'NEXT_PUBLIC_APP_NAME',
} as const;

type EnvSource = Record<string, string | undefined>;

/** The source with each new name taken from its old one when only the old one is set. */
function withLegacyNames(source: unknown): unknown {
  if (!source || typeof source !== 'object') return source;
  const env = { ...(source as EnvSource) };
  for (const [name, legacy] of Object.entries(LEGACY_ENV_NAMES)) {
    if ((env[name] === undefined || env[name] === '') && env[legacy] !== undefined) {
      env[name] = env[legacy];
    }
  }
  return env;
}

/**
 * The product name shown in the interface, the web manifest and on PDFs: `APP_NAME` (or the old
 * `NEXT_PUBLIC_APP_NAME`), else « Lynx École ». Read on the server at run time, never at build.
 */
export function appNameFrom(source: EnvSource = process.env): string {
  const name = (withLegacyNames(source) as EnvSource).APP_NAME?.trim();
  return name ? name : DEFAULT_APP_NAME;
}

/** A release name for the footer, `/api/health`, logs and heartbeats (D-117): `0.6.0`, `dev`. */
const appRelease = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/, 'letters, digits, . _ + - (at most 40)')
  .default('dev');

/**
 * `APP_RELEASE` for log lines (D-111, D-117), read at run time without validating the rest of the
 * environment, so a logger never fails: `dev` when unset or not a valid release name.
 */
export function appReleaseFrom(source: EnvSource = process.env): string {
  const parsed = appRelease.safeParse(source.APP_RELEASE || undefined);
  return parsed.success ? parsed.data : 'dev';
}

/** Settings the web app needs on the server. */
export const webServerEnvSchema = z.preprocess(
  withLegacyNames,
  z.object({
    /** The Supabase API, called by the web server only (the browser never calls Supabase). */
    SUPABASE_URL: z.url(),
    /** Supabase's public "anon" key; row level security protects all data. */
    SUPABASE_ANON_KEY: z.string().min(20),
    /** Not used by the web app, which always runs as the signed-in user (D-012). */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    APP_BASE_URL: z.url().default('http://localhost:3000'),
    APP_NAME: z.string().trim().min(1).default(DEFAULT_APP_NAME),
    /** The release this server runs, set when the image is built (D-117). */
    APP_RELEASE: appRelease,
    /** Shown for « Pour supprimer ce compte… » and support questions, when set (D-107, D-110). */
    SUPPORT_EMAIL: z.email().optional(),
    /** Shown on « Confidentialité et conditions », when set (D-110). */
    PRIVACY_CONTACT_EMAIL: z.email().optional(),
    /**
     * Keys for encrypting safety/medical alert text, as "version:base64key" pairs separated by
     * commas (32-byte keys). The highest version encrypts; all versions can decrypt.
     * Leave empty to keep the alerts feature unavailable.
     */
    ALERTS_ENCRYPTION_KEYS: z.string().default(''),
    /**
     * Direct Postgres connection for the substitute portal, as the database role
     * lynx_sub_portal (DECISIONS D-049). Server-only. Unset: the portal shows that substitute
     * access is not configured, and codes cannot be issued.
     */
    SUB_PORTAL_DATABASE_URL: z.string().min(1).optional(),
    /**
     * Keys for hashing substitute access codes (and the device and network keys used for
     * throttling), in the same "version:base64key" format as ALERTS_ENCRYPTION_KEYS: at most two,
     * the current one (highest version) and the previous one during a rotation. Empty: codes
     * cannot be issued or redeemed.
     */
    SUB_CODE_HMAC_KEYS: z.string().default(''),
    /** Request header that carries the client address (set or appended by the reverse proxy). */
    CLIENT_IP_HEADER: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .transform((v) => v.toLowerCase())
      .default('x-forwarded-for'),
    /**
     * How many trusted proxies append to CLIENT_IP_HEADER: the client address is the entry this
     * many places from the right. 0 ignores the header (every request shares one bucket).
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    /**
     * Direct Postgres connection for class devices (« Quiz sur les appareils »), as the database
     * role lynx_class_portal (DECISIONS D-083), kept apart from the substitute portal's. Server-only.
     * Unset: quizzes on devices are off, and « Présenter à la classe » still works.
     */
    CLASS_PORTAL_DATABASE_URL: z.string().min(1).optional(),
    /**
     * Key for the device and network keys that throttle joining (32 random bytes, base64;
     * D-083, D-084). Its own key, so an install with the Library module but without the
     * substitute portal still works. Empty: quizzes on devices are off.
     */
    CLASS_PORTAL_HMAC_KEY: z.string().default(''),
  }),
);

export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

/**
 * The most one bulk generation run may cost, in US dollars of provider cost at its worst case
 * (DECISIONS D-096): the worker refuses to submit a run whose cap is higher, and
 * `pnpm admin bulk-plan` checks the same value. At most 1,000, the database's own limit.
 */
const bulkMaxRunUsd = z.coerce.number().positive().max(1000).default(100);

/** Settings the background worker needs. */
export const workerEnvSchema = z.preprocess(
  withLegacyNames,
  z
    .object({
      /** Direct (session) Postgres connection: the worker uses LISTEN/NOTIFY. */
      DATABASE_URL: z.string().min(1),
      /**
       * Supabase Auth's admin API, for staff invitations (D-107): the worker creates the accounts
       * board admins invite, and bans or unbans those whose access is removed or restored. Both
       * unset: invitations fail as « non configurées ». Never in the web server's environment.
       */
      SUPABASE_URL: z.url().optional(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
      /** Port of the worker's `/healthz` (D-112); 0 turns it off. */
      WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(0),
      /** The release this worker runs (D-117), in its heartbeat and logs. */
      APP_RELEASE: appRelease,
      /** Pinged after every heartbeat by an external monitor (D-112); it receives no data. */
      HEARTBEAT_URL_WORKER: z.url().optional(),
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
      OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
      INTEGRATIONS_MODE: z.enum(['mock']).default('mock'),
      LOG_EVENTS: bool.default(true),
      /**
       * AI runs only in the worker, which alone holds the provider key. "none": AI requests fail
       * with "unavailable". "fake": answers built locally, nothing leaves the machine (tests,
       * demos). "anthropic": Claude through the Anthropic API.
       */
      AI_PROVIDER: z.enum(['none', 'fake', 'anthropic']).default('none'),
      ANTHROPIC_API_KEY: z.string().min(20).optional(),
      AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
      AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
      /** Prices in USD per million tokens, for models the app does not know yet. */
      AI_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
      AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
      /** Days before AI requests (inputs and answers) are deleted. Usage records are kept. */
      AI_JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
      /** Simulated latency of the fake provider, in milliseconds. */
      AI_FAKE_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(800),
      BULK_MAX_RUN_USD: bulkMaxRunUsd,
    })
    .refine((env) => env.AI_PROVIDER !== 'anthropic' || env.ANTHROPIC_API_KEY, {
      message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic',
      path: ['ANTHROPIC_API_KEY'],
    }),
);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Settings the admin CLI needs (`pnpm admin`, run only from a trusted machine). */
export const adminEnvSchema = z.preprocess(
  withLegacyNames,
  z.object({
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    BULK_MAX_RUN_USD: bulkMaxRunUsd,
    /**
     * The worker's AI settings, read by `pnpm admin bulk-plan` to price a run's worst case as the
     * worker will (the fake provider's nominal price, or the model's, or the prices set here).
     */
    AI_PROVIDER: z.enum(['none', 'fake', 'anthropic']).default('none'),
    AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
    AI_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
    AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
  }),
);

export type AdminEnv = z.infer<typeof adminEnvSchema>;

export class EnvError extends Error {}

/** Parses the environment, failing with a readable list of what is missing or invalid. */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  // Treat empty strings as unset so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new EnvError(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
