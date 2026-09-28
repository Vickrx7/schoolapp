'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'required').max(120, 'tooLong'),
  honorific: z
    .string()
    .trim()
    .max(20, 'tooLong')
    .transform((s) => s || null),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = parseInput(profileSchema, input);
  if (!parsed.ok) return parsed.result;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('users')
    .update({ display_name: parsed.data.displayName, honorific: parsed.data.honorific })
    .eq('id', session.userId);
  if (error) return fail(reportError('updateProfile', error));
  revalidatePath('/', 'layout');
  return okVoid();
}
