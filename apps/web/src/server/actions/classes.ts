'use server';

import { classFormSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

export async function createClass(
  input: z.input<typeof classFormSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  const parsed = parseInput(classFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_class', {
    p_school_id: v.schoolId,
    p_school_year_id: v.schoolYearId,
    p_name: v.name,
    p_grade_codes: v.gradeCodes,
    ...(v.roomId ? { p_room_id: v.roomId } : {}),
  });
  if (error || !data) return fail(reportError('createClass', error));
  revalidatePath('/classes');
  revalidatePath('/today');
  return ok({ id: data });
}

const updateSchema = z.object({
  name: z.string().trim().min(1, 'required').max(80, 'tooLong'),
  roomId: z.uuid().nullable(),
  gradeCodes: z.array(z.string().regex(/^[A-Z0-9]{1,4}$/)).min(1, 'atLeastOneGrade'),
});

export async function updateClass(
  classId: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const parsed = parseInput(updateSchema, input);
  if (!parsed.ok || !z.uuid().safeParse(classId).success)
    return parsed.ok ? fail('invalid') : parsed.result;
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('classes')
    .update({ name: v.name, room_id: v.roomId })
    .eq('id', classId);
  if (error) return fail(reportError('updateClass', error));

  const { data: current } = await supabase
    .from('class_grades')
    .select('grade_code')
    .eq('class_id', classId);
  const existing = new Set((current ?? []).map((g) => g.grade_code));
  const wanted = new Set(v.gradeCodes);
  const toAdd = [...wanted].filter((g) => !existing.has(g));
  const toRemove = [...existing].filter((g) => !wanted.has(g));
  if (toAdd.length) {
    const { error: e } = await supabase
      .from('class_grades')
      .insert(toAdd.map((g) => ({ class_id: classId, grade_code: g })));
    if (e) return fail(reportError('updateClass.grades', e));
  }
  if (toRemove.length) {
    const { error: e } = await supabase
      .from('class_grades')
      .delete()
      .eq('class_id', classId)
      .in('grade_code', toRemove);
    if (e) return fail(reportError('updateClass.grades', e));
  }
  revalidatePath(`/classes/${classId}`, 'layout');
  revalidatePath('/classes');
  return okVoid();
}

export async function deleteClass(classId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(classId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('classes').delete().eq('id', classId).select('id');
  if (error) return fail(reportError('deleteClass', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/classes');
  revalidatePath('/today');
  return okVoid();
}

const memberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['homeroom', 'subject', 'support']),
});

export async function addClassTeacher(
  classId: string,
  input: z.input<typeof memberSchema>,
): Promise<ActionResult> {
  const parsed = parseInput(memberSchema, input);
  if (!parsed.ok) return parsed.result;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('class_teachers').insert({
    class_id: classId,
    user_id: parsed.data.userId,
    role: parsed.data.role,
    added_by: session.userId,
  });
  if (error) return fail(reportError('addClassTeacher', error));
  revalidatePath(`/classes/${classId}`, 'layout');
  return okVoid();
}

export async function removeClassTeacher(classId: string, userId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_teachers')
    .delete()
    .eq('class_id', classId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return fail(reportError('removeClassTeacher', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath(`/classes/${classId}`, 'layout');
  revalidatePath('/today');
  return okVoid();
}
