'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { readinessFieldErrors, reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * The board's designated reviewers (DECISIONS D-064, D-065): « Approuver pour le conseil »,
 * « Renvoyer pour révision », « Contenu de foi conforme », « Signaler du contenu de foi » and
 * « Retirer de la banque ». The database checks who may do what (a reviewer of that kind for the
 * item's board, never on their own item) and refuses a decision on a version the reviewer did
 * not see (`LXL07`, « Cette ressource a changé depuis que vous l'avez ouverte »).
 */

const decisionSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(1000, 'tooLong'),
    revision: z.number().int(),
  })
  .refine((d) => d.decision === 'approve' || d.note.length > 0, {
    path: ['note'],
    message: 'required',
  });

const refresh = (itemId: string) => {
  revalidatePath(`/library/items/${itemId}`);
  revalidatePath('/library/review');
  revalidatePath('/library/mine');
  revalidatePath('/library');
};

async function reviewer() {
  const session = await requireSession();
  return session.libraryReviewer.length > 0 ? session : null;
}

function parseDecision(input: unknown) {
  const parsed = decisionSchema.safeParse(input);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[issue.path.join('.') || 'form'] ??= /^[a-zA-Z]+$/.test(issue.message)
      ? issue.message
      : 'invalid';
  }
  return { ok: false as const, result: fail('invalid', fieldErrors) };
}

/** « Approuver pour le conseil » or « Renvoyer pour révision » (with a note for the author). */
export async function decideItem(
  itemId: string,
  decision: 'approve' | 'reject',
  note: string,
  revision: number,
): Promise<ActionResult> {
  if (!(await reviewer())) return fail('forbidden');
  const parsed = parseDecision({ itemId, decision, note, revision });
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('library_decide', {
    p_item_id: parsed.data.itemId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
    p_expected_revision: parsed.data.revision,
  });
  if (error) return fail(reportError('decideItem', error), readinessFieldErrors(error));
  refresh(itemId);
  return okVoid();
}

/** « Contenu de foi conforme » or « Renvoyer pour révision », by a faith reviewer. */
export async function decideFaith(
  itemId: string,
  decision: 'approve' | 'reject',
  note: string,
  revision: number,
): Promise<ActionResult> {
  if (!(await reviewer())) return fail('forbidden');
  const parsed = parseDecision({ itemId, decision, note, revision });
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('library_faith_decide', {
    p_item_id: parsed.data.itemId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
    p_expected_revision: parsed.data.revision,
  });
  if (error) return fail(reportError('decideFaith', error));
  refresh(itemId);
  return okVoid();
}

/**
 * « Signaler du contenu de foi »: the author did not tick it. The author cannot clear the flag,
 * and an item shared with the whole board goes back to its school until its faith review.
 */
export async function flagFaith(itemId: string): Promise<ActionResult> {
  if (!(await reviewer())) return fail('forbidden');
  if (!z.uuid().safeParse(itemId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('library_flag_faith', { p_item_id: itemId });
  if (error) return fail(reportError('flagFaith', error));
  refresh(itemId);
  return okVoid();
}

/** « Retirer de la banque »: a shared or approved item goes back to its author, with a note. */
export async function retractItem(itemId: string, note: string): Promise<ActionResult> {
  if (!(await reviewer())) return fail('forbidden');
  const input = z
    .object({ itemId: z.uuid(), note: z.string().trim().min(1, 'required').max(1000, 'tooLong') })
    .safeParse({ itemId, note });
  if (!input.success) {
    const issue = input.error.issues[0];
    return fail('invalid', issue?.path[0] === 'note' ? { note: issue.message } : undefined);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('library_retract', {
    p_item_id: input.data.itemId,
    p_note: input.data.note,
  });
  if (error) return fail(reportError('retractItem', error));
  refresh(itemId);
  return okVoid();
}
