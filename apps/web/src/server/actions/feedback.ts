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
import { visiblePeople } from '../ai-people';
import { reportError } from '../errors';
import { findPersonalInfo, guardVerdict } from '../library/share-guard';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Commentaires » (DECISIONS D-116): a problem, an idea or a question, up to 2,000 characters,
 * read by the board's admins. The message is checked for students' first names first (the
 * first-name guard of sharing, D-066): each name is confirmed before it is sent, and other
 * personal details (an address, a phone number…) must be removed. Recorded with the page's route
 * template (never its address), the error reference an error page showed, the release, the kind
 * of device and the language; at most 20 a day (`feedbackLimit`).
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
  /** Names to confirm, details to remove: nothing was sent. */
  | { sent: false; names: string[]; blocked: string[] };

const namesSchema = z.array(z.string().max(200)).max(50);

export async function sendFeedback(
  input: FeedbackInput,
  confirmedNames: string[] = [],
): Promise<ActionResult<SendFeedbackResult>> {
  const parsed = parseInput(feedbackSchema, input);
  if (!parsed.ok) return parsed.result;
  const names = namesSchema.safeParse(confirmedNames);
  if (!names.success) return fail('invalid');
  const session = await requireSession();
  // The sender's board (and school): the first school where they work, else their board.
  const school = session.schools[0] ?? null;
  const boardId = school?.boardId ?? session.boards[0]?.id;
  if (!boardId) return fail('forbidden');

  const supabase = await createSupabaseServerClient();
  const verdict = guardVerdict(
    findPersonalInfo([parsed.data.message], await visiblePeople(supabase)),
    names.data,
  );
  if (!verdict.ok) return ok({ sent: false, names: verdict.names, blocked: verdict.blocked });

  // The page the button was used on (server actions are posted to it): its template only.
  const path = (await headers()).get(REQUEST_PATH_HEADER) ?? '/';
  const { error } = await supabase.rpc('submit_feedback', {
    p_board_id: boardId,
    p_school_id: school?.id ?? (null as unknown as string),
    p_kind: parsed.data.kind,
    p_message: parsed.data.message,
    p_route: routeTemplate(path),
    p_error_ref: parsed.data.errorRef ?? (null as unknown as string),
    p_release: appReleaseFrom(process.env),
    p_device: parsed.data.device ?? (null as unknown as string),
    p_locale: await getLocale(),
    p_may_contact: parsed.data.mayContact,
  });
  if (error) return fail(reportError('sendFeedback', error));
  return ok({ sent: true });
}
