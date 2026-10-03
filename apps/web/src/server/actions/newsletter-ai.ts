'use server';

import { newsletterTranslateInputSchema } from '@lynx/ai/features/newsletter-translate';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import {
  buildTranslatePreview,
  sameKeys,
  type NewsletterTranslatePreview,
} from '../newsletter/ai-preview';
import { loadClass } from '../queries/classes';
import { aiOn, findSchool, hasModule, hasRole, requireSession } from '../session';
import { createSupabaseServerClient, type ServerSupabase } from '../supabase';

/**
 * « Traduire en anglais (IA) » (DECISIONS D-139). The editor sends the message's id and the scope
 * only: the database builds the request from the stored message (`newsletter_ai_preview`), the
 * server shows the teacher exactly what would be sent (names the app knows replaced, the
 * paragraphs left out and why, the capitalized words to check), and nothing is sent before she
 * ticks « J'ai vérifié » and presses « Envoyer à l'IA ». The request is for the revision and the
 * paragraphs she saw (`sendKeys`); the worker runs it and the database writes the English back
 * while the message is unchanged. Off wherever the school's AI is off. Errors carry codes only.
 */

const AI_ERRORS: Record<string, string> = {
  LXA01: 'aiDisabled',
  LXA02: 'aiBudgetReached',
  LXA03: 'aiBusy',
};

const uuid = z.uuid();
const scopeSchema = z.enum(['missing', 'all']);
export type NewsletterTranslateScope = z.infer<typeof scopeSchema>;

type Prepared =
  | { ok: false; result: ActionResult<never> }
  | {
      ok: true;
      supabase: ServerSupabase;
      preview: NewsletterTranslatePreview;
      route: string;
    };

async function prepare(id: string, scope: string): Promise<Prepared> {
  const session = await requireSession();
  const parsedScope = scopeSchema.safeParse(scope);
  if (!uuid.safeParse(id).success || !parsedScope.success) {
    return { ok: false, result: fail('invalid') };
  }
  const supabase = await createSupabaseServerClient();
  const { data: row, error: readError } = await supabase
    .from('class_newsletters')
    .select('class_id, week_of')
    .eq('id', id)
    .maybeSingle();
  if (readError) return { ok: false, result: fail(reportError('previewNewsletterAi', readError)) };
  if (!row) return { ok: false, result: fail('notFound') };
  const cls = await loadClass(session, row.class_id);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  if (!cls?.myRole || !school || !hasModule(school, 'teaching') || !hasRole(school, 'teacher')) {
    return { ok: false, result: fail('forbidden') };
  }
  if (!aiOn(session, school)) return { ok: false, result: fail('aiDisabled') };

  const { data, error } = await supabase.rpc('newsletter_ai_preview', {
    p_newsletter_id: id,
    p_scope: parsedScope.data,
  });
  if (error) return { ok: false, result: fail(reportError('previewNewsletterAi', error)) };
  const input = newsletterTranslateInputSchema.safeParse(data);
  if (!input.success) {
    // Paths and codes only: never the message's text.
    reportError('previewNewsletterAi', {
      code: 'invalid_input',
      message: input.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','),
    });
    return { ok: false, result: fail('invalid') };
  }
  const preview = buildTranslatePreview(input.data, await visiblePeople(supabase));
  return {
    ok: true,
    supabase,
    preview,
    route: `/classes/${row.class_id}/info-parents/${row.week_of}`,
  };
}

/** « Vérifier avant d'envoyer »: exactly what would be sent for the saved message. */
export async function previewNewsletterTranslation(
  id: string,
  scope: NewsletterTranslateScope,
): Promise<ActionResult<NewsletterTranslatePreview>> {
  const prepared = await prepare(id, scope);
  if (!prepared.ok) return prepared.result;
  return ok(prepared.preview);
}

/**
 * « Envoyer à l'IA »: only with the box ticked (`newsletterUnconfirmed`), for the revision and
 * the paragraphs the teacher previewed (`newsletterStale` otherwise: the message, or what the app
 * would leave out, changed since; she checks again).
 */
export async function requestNewsletterTranslation(
  id: string,
  scope: NewsletterTranslateScope,
  expectedRevision: number,
  sendKeys: string[],
  confirmed: boolean,
): Promise<ActionResult<{ jobId: string }>> {
  await requireSession();
  if (confirmed !== true) return fail('newsletterUnconfirmed');
  if (
    !Number.isInteger(expectedRevision) ||
    !Array.isArray(sendKeys) ||
    sendKeys.some((k) => typeof k !== 'string')
  ) {
    return fail('invalid');
  }
  const prepared = await prepare(id, scope);
  if (!prepared.ok) return prepared.result;
  const { preview } = prepared;
  if (preview.revision !== expectedRevision || !sameKeys(sendKeys, preview.sendKeys)) {
    return fail('newsletterStale');
  }
  if (!preview.sendKeys.length) return fail('personalInfo');
  const { data, error } = await prepared.supabase.rpc('request_newsletter_translation', {
    p_newsletter_id: id,
    p_scope: preview.scope,
    p_expected_revision: preview.revision,
    p_send_keys: preview.sendKeys,
  });
  if (error) {
    const known = error.code ? AI_ERRORS[error.code] : undefined;
    return fail(known ?? reportError('requestNewsletterAi', error));
  }
  revalidatePath(prepared.route);
  return ok({ jobId: data });
}
