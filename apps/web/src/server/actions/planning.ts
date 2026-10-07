'use server';

import { lessonFormSchema, unitFormSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const refresh = (classId: string, unitId?: string) => {
  revalidatePath(`/classes/${classId}/planning`);
  if (unitId) revalidatePath(`/classes/${classId}/planning/${unitId}`);
  revalidatePath('/today');
};

export async function createUnit(
  input: z.input<typeof unitFormSchema>,
  makeActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(unitFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('units')
    .insert({
      class_id: v.classId,
      subject_id: v.subjectId,
      title: v.title,
      description: v.description,
    })
    .select('id')
    .single();
  if (error || !data) return fail(reportError('createUnit', error));
  if (makeActive) {
    const { error: e } = await supabase.rpc('set_active_unit', { p_unit_id: data.id });
    if (e) return fail(reportError('createUnit.activate', e));
  }
  refresh(v.classId);
  return ok({ id: data.id });
}

const unitUpdateSchema = z.object({
  title: z.string().trim().min(1, 'required').max(120, 'tooLong'),
  description: z
    .string()
    .trim()
    .max(2000, 'tooLong')
    .transform((s) => s || null),
});

export async function updateUnit(
  classId: string,
  unitId: string,
  input: z.input<typeof unitUpdateSchema>,
): Promise<ActionResult> {
  const parsed = parseInput(unitUpdateSchema, input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('units')
    .update(parsed.data)
    .eq('id', unitId)
    .select('id');
  if (error) return fail(reportError('updateUnit', error));
  if (!data?.length) return fail('forbidden');
  refresh(classId, unitId);
  return okVoid();
}

export async function setUnitStatus(
  classId: string,
  unitId: string,
  status: 'active' | 'planned' | 'completed' | 'archived',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } =
    status === 'active'
      ? await supabase.rpc('set_active_unit', { p_unit_id: unitId })
      : await supabase.from('units').update({ status }).eq('id', unitId);
  if (error) return fail(reportError('setUnitStatus', error));
  refresh(classId, unitId);
  return okVoid();
}

export async function deleteUnit(classId: string, unitId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('units').delete().eq('id', unitId).select('id');
  if (error) return fail(reportError('deleteUnit', error));
  if (!data?.length) return fail('forbidden');
  refresh(classId);
  return okVoid();
}

export async function saveLesson(
  classId: string,
  unitId: string,
  input: z.input<typeof lessonFormSchema>,
  lessonId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(lessonFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const row = {
    title: v.title,
    objectives: v.objectives,
    materials: v.materials,
    content: v.content,
    sub_notes: v.subNotes,
    duration_minutes: v.durationMinutes,
  };
  const supabase = await createSupabaseServerClient();

  let id = lessonId;
  if (id) {
    const { data, error } = await supabase
      .from('unit_lessons')
      .update(row)
      .eq('id', id)
      .select('id');
    if (error) return fail(reportError('updateLesson', error));
    if (!data?.length) return fail('forbidden');
  } else {
    const { data: last } = await supabase
      .from('unit_lessons')
      .select('sequence_number')
      .eq('unit_id', unitId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from('unit_lessons')
      .insert({ ...row, unit_id: unitId, sequence_number: (last?.sequence_number ?? 0) + 1 })
      .select('id')
      .single();
    if (error || !data) return fail(reportError('createLesson', error));
    id = data.id;
  }

  // Replace expectation links with the submitted set.
  const { error: delError } = await supabase
    .from('unit_lesson_expectations')
    .delete()
    .eq('lesson_id', id);
  if (delError) return fail(reportError('saveLesson.expectations', delError));
  if (v.expectationIds.length) {
    const { error: insError } = await supabase
      .from('unit_lesson_expectations')
      .insert(v.expectationIds.map((expectation_id) => ({ lesson_id: id!, expectation_id })));
    if (insError) return fail(reportError('saveLesson.expectations', insError));
  }

  refresh(classId, unitId);
  return ok({ id });
}

export async function deleteLesson(
  classId: string,
  unitId: string,
  lessonId: string,
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('unit_lessons')
    .delete()
    .eq('id', lessonId)
    .select('id');
  if (error) return fail(reportError('deleteLesson', error));
  if (!data?.length) return fail('forbidden');
  // Close the gap in the numbering.
  const { data: rest } = await supabase
    .from('unit_lessons')
    .select('id')
    .eq('unit_id', unitId)
    .order('sequence_number');
  if (rest?.length) {
    await supabase.rpc('reorder_unit_lessons', {
      p_unit_id: unitId,
      p_lesson_ids: rest.map((l) => l.id),
    });
  }
  refresh(classId, unitId);
  return okVoid();
}

/** Moves a lesson one position up or down (touch-friendly alternative to drag and drop). */
export async function moveLesson(
  classId: string,
  unitId: string,
  lessonId: string,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: lessons, error } = await supabase
    .from('unit_lessons')
    .select('id')
    .eq('unit_id', unitId)
    .order('sequence_number');
  if (error || !lessons) return fail(reportError('moveLesson', error));
  const ids = lessons.map((l) => l.id);
  const i = ids.indexOf(lessonId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return okVoid();
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  const { error: e } = await supabase.rpc('reorder_unit_lessons', {
    p_unit_id: unitId,
    p_lesson_ids: ids,
  });
  if (e) return fail(reportError('moveLesson', e));
  refresh(classId, unitId);
  return okVoid();
}
