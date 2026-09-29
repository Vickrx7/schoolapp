/**
 * Environment configuration, validated with Zod. Every setting comes from environment
 * variables (documented in .env.example) so the same build runs hosted or board-hosted.
 */
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Settings the web app needs on the server. */
export const webServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  /** Server-only. Used by admin tooling; the web app itself runs as the signed-in user. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Lynx École'),
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
});

export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

/** Settings the background worker needs. */
export const workerEnvSchema = z
  .object({
    /** Direct (session) Postgres connection: the worker uses LISTEN/NOTIFY. */
    DATABASE_URL: z.string().min(1),
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
  })
  .refine((env) => env.AI_PROVIDER !== 'anthropic' || env.ANTHROPIC_API_KEY, {
    message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic',
    path: ['ANTHROPIC_API_KEY'],
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

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
