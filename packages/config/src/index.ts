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
  /** AI features (Phase 2). "none" keeps every AI feature off. */
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai_compatible']).default('none'),
});

export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

/** Settings the background worker needs. */
export const workerEnvSchema = z.object({
  /** Direct (session) Postgres connection: the worker uses LISTEN/NOTIFY. */
  DATABASE_URL: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  INTEGRATIONS_MODE: z.enum(['mock']).default('mock'),
  LOG_EVENTS: bool.default(true),
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
