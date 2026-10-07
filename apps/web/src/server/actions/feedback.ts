'use server';

import { appReleaseFrom } from '@lynx/config';
import { isReference } from '@lynx/observability';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import { FEEDBACK_KINDS, FEEDBACK_MAX } from '@/lib/feedback';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';
import { routeTemplate } from '@/lib/route-template';
import { reportError } from '../errors';
import { studentMarker, withoutStudentNames } from '../feedback-names';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Commentaires » (DECISIONS D-116): a problem, an idea or a question, up to 2,000 characters,
 * read by the board's admins. The first names of the students of the sender's schools are
 * replaced with « [élève] » before it is stored (D-116, as amended in the Phase 6 review: the
 * readers see no student data); other personal details (an address, a phone number…) must be
 * removed first. Recorded with the page's route template (never its address), the error
 * reference an error page showed, the release, the kind of device and the language; at most 20 a
 * day (`feedbackLimit`).
 */

const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1, 'required').max(FEEDBACK_MAX, 'tooLong'),
  /** « Référence : … » from an error page (D-111): its digest or random reference only. */
  errorRef: z
    .string()
    .trim()
    .max(40, 'tooLong')
    .nullable()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isReference(v), 'invalid'),
  device: z.enum(['phone', 'tablet', 'desktop']).nullable(),
  mayContact: z.boolean(),
});

export type FeedbackInput = z.input<typeof feedbackSchema>;

export type SendFeedbackResult =
  | { sent: true }
  /** Personal details to remove: nothing was sent. */
  | { sent: false; blocked: string[] };

export async function sendFeedback(
  input: FeedbackInput,
): Promise<ActionResult<SendFeedbackResult>> {
  const parsed = parseInput(feedbackSchema, input);
  if (!parsed.ok) return parsed.result;
  const session = await requireSession();
  // The sender's board (and school): the first school where they work, else their board.
  const school = session.schools[0] ?? null;
  const boardId = school?.boardId ?? session.boards[0]?.id;
  if (!boardId) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  // The first names of the students of the sender's schools that may be in the message.
  const { data: firstNames, error: namesError } = await supabase.rpc('feedback_student_names', {
    p_text: parsed.data.message,
  });
  if (namesError) return fail(reportError('sendFeedback', namesError));
  const locale = await getLocale();
  const cleaned = withoutStudentNames(parsed.data.message, firstNames ?? [], studentMarker(locale));
  if (cleaned.blocked.length > 0) return ok({ sent: false, blocked: cleaned.blocked });

  // The page the button was used on (server actions are posted to it): its template only.
  const path = (await headers()).get(REQUEST_PATH_HEADER) ?? '/';
  const { error } = await supabase.rpc('submit_feedback', {
    p_board_id: boardId,
    p_school_id: school?.id ?? (null as unknown as string),
    p_kind: parsed.data.kind,
    // A longer marker can push a full message past the limit: its end is cut.
    p_message: cleaned.text.slice(0, FEEDBACK_MAX),
    p_route: routeTemplate(path),
    p_error_ref: parsed.data.errorRef ?? (null as unknown as string),
    p_release: appReleaseFrom(process.env),
    p_device: parsed.data.device ?? (null as unknown as string),
    p_locale: locale,
    p_may_contact: parsed.data.mayContact,
  });
  if (error) return fail(reportError('sendFeedback', error));
  return ok({ sent: true });
}
