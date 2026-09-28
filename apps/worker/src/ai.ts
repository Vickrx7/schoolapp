/**
 * Runs AI jobs requested through public.request_ai_job. The worker is the only place that
 * holds the provider key and the only writer of ai_generations (usage and cost).
 *
 * Privacy: the job input can name students. It is de-identified here with the whole school's
 * roster before anything is sent, and the run is refused if a personal detail remains (see
 * packages/ai/src/privacy.ts). Logs never contain inputs or answers.
 */
import {
  createAnthropicProvider,
  createFakeProvider,
  features,
  loadPrompt,
  priceFor,
  runFeature,
  type AiProvider,
  type KnownPerson,
  type ModelPrice,
} from '@lynx/ai';
import type { WorkerEnv } from '@lynx/config';
import type { Pool } from 'pg';
import type { Logger } from './logger';

export interface AiRuntime {
  provider: AiProvider;
  price: ModelPrice;
}

/** Null when AI_PROVIDER=none: every request then fails as "unavailable". */
export function createAiRuntime(env: WorkerEnv): AiRuntime | null {
  if (env.AI_PROVIDER === 'none') return null;
  const provider =
    env.AI_PROVIDER === 'fake'
      ? createFakeProvider({ delayMs: env.AI_FAKE_DELAY_MS })
      : createAnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.AI_MODEL,
          effort: env.AI_EFFORT,
        });
  const price = priceFor(provider.model, {
    input: env.AI_PRICE_INPUT_PER_MTOK,
    output: env.AI_PRICE_OUTPUT_PER_MTOK,
  });
  return { provider, price };
}

interface JobRow {
  id: string;
  board_id: string;
  school_id: string;
  user_id: string;
  feature: string;
  input: unknown;
}

/** Students and staff of the school, plus the requester: nobody here may leave Canada. */
export async function loadKnownPeople(
  pool: Pool,
  schoolId: string,
  userId: string,
): Promise<KnownPerson[]> {
  const { rows } = await pool.query<{ name: string; kind: 'student' | 'staff' }>(
    `select s.first_name as name, 'student' as kind
       from public.students s
       join public.classes c on c.id = s.class_id
      where c.school_id = $1
     union
     select u.display_name, 'staff'
       from public.users u
       join public.user_roles ur on ur.user_id = u.id
      where ur.school_id = $1
         or (ur.school_id is null and ur.board_id = (select board_id from public.schools where id = $1))
     union
     select u.display_name, 'staff' from public.users u where u.id = $2`,
    [schoolId, userId],
  );
  return rows;
}

async function finishJob(
  pool: Pool,
  jobId: string,
  fields: {
    status: 'succeeded' | 'failed';
    errorCode: string | null;
    result?: unknown;
    sentText?: string | null;
    generationId?: string | null;
  },
) {
  await pool.query(
    `update public.ai_jobs
        set status = $2, error_code = $3, result = $4, sent_text = $5, ai_generation_id = $6,
            finished_at = now()
      where id = $1`,
    [
      jobId,
      fields.status,
      fields.errorCode,
      fields.result === undefined ? null : JSON.stringify(fields.result),
      fields.sentText ?? null,
      fields.generationId ?? null,
    ],
  );
}

export async function runAiJob(
  jobId: string,
  deps: { pool: Pool; ai: AiRuntime | null; logger: Logger },
): Promise<void> {
  const { pool, ai, logger } = deps;
  // Claim the job; a retry of an already handled event finds nothing to do.
  const claimed = await pool.query<JobRow>(
    `update public.ai_jobs set status = 'running', started_at = now()
      where id = $1 and status = 'queued'
      returning id, board_id, school_id, user_id, feature, input`,
    [jobId],
  );
  const job = claimed.rows[0];
  if (!job) return;

  try {
    const feature = features[job.feature];
    if (!feature) {
      await finishJob(pool, job.id, { status: 'failed', errorCode: 'invalidInput' });
      return;
    }
    if (!ai) {
      await finishJob(pool, job.id, { status: 'failed', errorCode: 'aiUnavailable' });
      return;
    }
    const school = await pool.query<{ ai_enabled: boolean }>(
      `select s.ai_enabled and coalesce((b.settings -> 'ai' ->> 'allowed')::boolean, true) as ai_enabled
         from public.schools s join public.boards b on b.id = s.board_id
        where s.id = $1`,
      [job.school_id],
    );
    if (!school.rows[0]?.ai_enabled) {
      await finishJob(pool, job.id, { status: 'failed', errorCode: 'aiDisabled' });
      return;
    }

    const [people, systemPrompt] = await Promise.all([
      loadKnownPeople(pool, job.school_id, job.user_id),
      loadPrompt(feature.name, feature.promptVersion),
    ]);
    const run = await runFeature({
      feature,
      provider: ai.provider,
      price: ai.price,
      systemPrompt,
      input: job.input,
      people,
    });

    // Usage is recorded whenever something was sent: failed calls cost money too.
    let generationId: string | null = null;
    if (run.sentText !== null) {
      const gen = await pool.query<{ id: string }>(
        `insert into public.ai_generations (
           board_id, school_id, user_id, feature, prompt_version, provider, model,
           input_tokens, output_tokens, cache_read_tokens, latency_ms, estimated_cost_usd,
           status, error_code, provider_request_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id`,
        [
          job.board_id,
          job.school_id,
          job.user_id,
          feature.name,
          feature.promptVersion,
          ai.provider.name,
          run.model,
          run.usage.inputTokens + run.usage.cacheWriteTokens,
          run.usage.outputTokens,
          run.usage.cacheReadTokens,
          run.latencyMs,
          run.costUsd,
          run.status,
          run.errorCode,
          run.providerRequestIds.at(-1) ?? null,
        ],
      );
      generationId = gen.rows[0]?.id ?? null;
    }

    await finishJob(pool, job.id, {
      status: run.status === 'succeeded' ? 'succeeded' : 'failed',
      errorCode: run.errorCode,
      result: run.output ?? undefined,
      sentText: run.sentText,
      generationId,
    });
    logger.info('ai job finished', {
      jobId: job.id,
      feature: feature.name,
      status: run.status,
      errorCode: run.errorCode,
      attempts: run.attempts,
      costUsd: run.costUsd,
      latencyMs: run.latencyMs,
      problems: run.problems,
    });
  } catch (error) {
    logger.error('ai job crashed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await finishJob(pool, job.id, { status: 'failed', errorCode: 'aiError' }).catch(
      () => undefined,
    );
  }
}
