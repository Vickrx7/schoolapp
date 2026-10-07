'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const levelSchema = z.object({
  label: z.string().trim().min(1, 'required').max(60, 'tooLong'),
  description: z.string().trim().max(1000, 'tooLong'),
});

function codeFor(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6);
  return `${base || 'niveau'}_${suffix}`;
}

/** A teacher's own level, alongside the board's. Only its owner sees it. */
export async function createPersonalLevel(
  boardId: string,
  input: z.input<typeof levelSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = parseInput(levelSchema, input);
  if (!parsed.ok) return parsed.result;
  if (!session.boards.some((b) => b.id === boardId)) return fail('forbidden');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('language_levels').insert({
    board_id: boardId,
    owner_user_id: session.userId,
    code: codeFor(parsed.data.label),
    label_fr: parsed.data.label,
    description_fr: parsed.data.description || null,
    sort_order: 1000,
  });
  if (error) return fail(reportError('createPersonalLevel', error));
  revalidatePath('/differentiate', 'layout');
  return okVoid();
}

export async function updatePersonalLevel(
  levelId: string,
  input: z.input<typeof levelSchema> & { active: boolean },
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = parseInput(levelSchema.extend({ active: z.boolean() }), input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('language_levels')
    .update({
      label_fr: parsed.data.label,
      description_fr: parsed.data.description || null,
      active: parsed.data.active,
    })
    .eq('id', levelId)
    .eq('owner_user_id', session.userId)
    .select('id');
  if (error) return fail(reportError('updatePersonalLevel', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/differentiate', 'layout');
  return okVoid();
}

/**
 * Deletes a personal level that nothing uses. A level still used by a saved text or by one of
 * the teacher's requests (in progress, or finished and not yet saved: saving needs the level)
 * can be turned off instead.
 */
export async function deletePersonalLevel(levelId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!z.uuid().safeParse(levelId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  // Requests hold their levels in their input (no foreign key), so check them first.
  const { data: jobs, error: jobsError } = await supabase
    .from('ai_jobs')
    .select('id')
    .eq('feature', 'differentiate')
    .in('status', ['queued', 'running', 'succeeded'])
    .contains('input', { levels: [{ languageLevelId: levelId }] })
    .limit(1);
  if (jobsError) return fail(reportError('deletePersonalLevel', jobsError));
  if (jobs.length) return fail('levelInUse');
  const { data, error } = await supabase
    .from('language_levels')
    .delete()
    .eq('id', levelId)
    .eq('owner_user_id', session.userId)
    .select('id');
  // A saved text still has a version for this level: the database refuses (it checks every
  // saved text, including ones this teacher can't see).
  if (error?.code === '23503') return fail('levelInUse');
  if (error) return fail(reportError('deletePersonalLevel', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/differentiate', 'layout');
  return okVoid();
}
