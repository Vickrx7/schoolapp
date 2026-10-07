'use server';

import { timetableBlockSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const paths = (classId: string) => {
  revalidatePath(`/classes/${classId}/timetable`);
  revalidatePath('/today');
};

/** Creates the block on every chosen day, or updates one existing block. */
export async function saveTimetableBlock(
  input: z.input<typeof timetableBlockSchema>,
  blockId?: string,
): Promise<ActionResult> {
  await requireSession();
  const parsed = parseInput(timetableBlockSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const row = {
    start_time: v.startTime,
    end_time: v.endTime,
    kind: v.kind,
    subject_id: v.kind === 'subject' ? v.subjectId : null,
    title: v.title,
    teacher_id: v.teacherId,
    room_id: v.roomId,
    notes: v.notes,
  };

  const supabase = await createSupabaseServerClient();
  if (blockId) {
    const { data, error } = await supabase
      .from('timetable_blocks')
      .update({ ...row, day_key: v.dayKeys[0]! })
      .eq('id', blockId)
      .select('id');
    if (error) return fail(reportError('updateTimetableBlock', error));
    if (!data?.length) return fail('forbidden');
  } else {
    const { error } = await supabase
      .from('timetable_blocks')
      .insert(v.dayKeys.map((day_key) => ({ ...row, class_id: v.classId, day_key })));
    if (error) return fail(reportError('createTimetableBlocks', error));
  }
  paths(v.classId);
  return okVoid();
}

export async function deleteTimetableBlock(
  classId: string,
  blockId: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('timetable_blocks')
    .delete()
    .eq('id', blockId)
    .select('id');
  if (error) return fail(reportError('deleteTimetableBlock', error));
  if (!data?.length) return fail('forbidden');
  paths(classId);
  return okVoid();
}
