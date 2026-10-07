'use server';

import { localDateSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { createSupabaseServerClient } from '../supabase';

const lessonId = z.uuid();

/** One tap: the lesson was taught on this (school-local) date. */
export async function markLessonTaught(
  rawLessonId: string,
  rawDate: string,
): Promise<ActionResult> {
  const id = lessonId.safeParse(rawLessonId);
  const date = localDateSchema.safeParse(rawDate);
  if (!id.success || !date.success) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('mark_lesson_taught', {
    p_lesson_id: id.data,
    p_taught_on: date.data,
  });
  if (error) return fail(reportError('markLessonTaught', error));
  revalidatePath('/today');
  revalidatePath('/classes', 'layout');
  return okVoid();
}

export async function unmarkLesson(rawLessonId: string): Promise<ActionResult> {
  const id = lessonId.safeParse(rawLessonId);
  if (!id.success) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('unmark_lesson', { p_lesson_id: id.data });
  if (error) return fail(reportError('unmarkLesson', error));
  revalidatePath('/today');
  revalidatePath('/classes', 'layout');
  return okVoid();
}
