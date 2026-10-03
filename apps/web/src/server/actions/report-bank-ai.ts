'use server';

import {
  REPORT_BANK_AI_PERIODS,
  REPORT_BANK_LENGTH_KEYS,
  REPORT_BANK_MAX_EXPECTATIONS,
  REPORT_BANK_NOTE_MAX,
  reportCommentBankInputSchema,
} from '@lynx/ai/features/report-comment-bank';
import { GRADE_CODE_PATTERN, REPORT_BANK_SCOPES } from '@lynx/content';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import { buildReportBankPreview, type ReportBankPreview } from '../library/report-bank-preview';
import { aiOn, librarySchools, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Créer une banque avec l’IA » (DECISIONS D-132). The form sends ids and choices only: the
 * scope, the report, one grade, the subject, up to 12 attentes, the length of the entries and the
 * note (« Précisions »). The database builds the request from its tables
 * (`report_comment_bank_ai_preview`) and the server shows the teacher exactly the de-identified
 * text that would be sent, names highlighted (D-038). Nothing about her students is part of it,
 * and nothing is sent before she presses « Envoyer ». Her note (« Précisions ») is checked as
 * « Traduire en anglais (IA) » checks a paragraph (D-132, D-139, as amended in the post-MVP
 * review): a title not followed by a name the app knows blocks the request, the other
 * capitalized words are listed, and a note is sent only once she ticks « J'ai vérifié ».
 */

const AI_ERRORS: Record<string, string> = {
  LXA01: 'aiDisabled',
  LXA02: 'aiBudgetReached',
  LXA03: 'aiBusy',
};

/** An error of a bank AI function, as a key under `errors` (codes only are reported). */
function aiError(context: string, error: { code?: string; message?: string }): string {
  return (error.code && AI_ERRORS[error.code]) || reportError(context, error);
}

const bankSchema = z
  .object({
    schoolId: z.uuid(),
    scope: z.enum(REPORT_BANK_SCOPES),
    period: z.enum(REPORT_BANK_AI_PERIODS),
    gradeCode: z.string({ error: 'required' }).regex(GRADE_CODE_PATTERN, 'required'),
    subjectId: z.uuid({ error: 'required' }).nullable(),
    expectationIds: z.array(z.uuid()).max(REPORT_BANK_MAX_EXPECTATIONS, 'tooMany'),
    length: z.enum(REPORT_BANK_LENGTH_KEYS),
    teacherNote: z.string().trim().max(REPORT_BANK_NOTE_MAX, 'tooLong'),
  })
  .superRefine((form, ctx) => {
    const skills = form.scope === 'learning_skills';
    if (!skills && !form.subjectId) {
      ctx.addIssue({ code: 'custom', path: ['subjectId'], message: 'required' });
    }
    if (skills && (form.subjectId || form.expectationIds.length)) {
      ctx.addIssue({ code: 'custom', path: ['subjectId'], message: 'invalid' });
    }
  });
export type ReportBankForm = z.input<typeof bankSchema>;

export type { ReportBankPreview };

async function prepareBank(raw: ReportBankForm) {
  const session = await requireSession();
  const parsed = parseInput(bankSchema, raw);
  if (!parsed.ok) return { ok: false as const, result: parsed.result };
  const form = parsed.data;
  const school = librarySchools(session).find((s) => s.id === form.schoolId);
  if (!school) return { ok: false as const, result: fail('forbidden') };
  if (!aiOn(session, school)) return { ok: false as const, result: fail('aiDisabled') };
  const supabase = await createSupabaseServerClient();
  const skills = form.scope === 'learning_skills';
  const request = {
    scope: form.scope,
    period: form.period,
    gradeCode: form.gradeCode,
    subjectId: skills ? null : form.subjectId,
    expectationIds: skills ? [] : form.expectationIds,
    length: form.length,
    teacherNote: form.teacherNote,
  };
  const { data, error } = await supabase.rpc('report_comment_bank_ai_preview', {
    p_school_id: form.schoolId,
    p_request: request,
  });
  if (error) return { ok: false as const, result: fail(aiError('previewReportBank', error)) };
  const input = reportCommentBankInputSchema.safeParse(data);
  if (!input.success) {
    // Paths and codes only: never the request's text.
    reportError('previewReportBank', {
      code: 'invalid_input',
      message: input.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','),
    });
    return { ok: false as const, result: fail('invalid') };
  }
  const preview = buildReportBankPreview(input.data, await visiblePeople(supabase));
  return { ok: true as const, supabase, form, request, preview };
}

/** « Vérifier avant d’envoyer »: exactly what would be sent. */
export async function previewReportBankGeneration(
  raw: ReportBankForm,
): Promise<ActionResult<ReportBankPreview>> {
  const prepared = await prepareBank(raw);
  if (!prepared.ok) return prepared.result;
  return ok(prepared.preview);
}

/**
 * « Envoyer »: queues the request (the database builds it again from the same ids). With a note,
 * only once « J'ai vérifié » is ticked (`reportBankUnconfirmed`).
 */
export async function requestReportBankGeneration(
  raw: ReportBankForm,
  confirmed = false,
): Promise<ActionResult<{ jobId: string }>> {
  const prepared = await prepareBank(raw);
  if (!prepared.ok) return prepared.result;
  if (prepared.preview.blocked.length) return fail('personalInfo');
  if (prepared.preview.note && confirmed !== true) return fail('reportBankUnconfirmed');
  const { data, error } = await prepared.supabase.rpc('request_report_comment_bank', {
    p_school_id: prepared.form.schoolId,
    p_request: prepared.request,
  });
  if (error) return fail(aiError('requestReportBank', error));
  revalidatePath('/library');
  return ok({ jobId: data });
}
