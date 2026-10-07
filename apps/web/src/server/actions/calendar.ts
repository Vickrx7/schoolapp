'use server';

import { calendarEventFormSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { findSchool, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

export async function saveCalendarEvent(
  input: z.input<typeof calendarEventFormSchema>,
  eventId?: string,
): Promise<ActionResult> {
  const parsed = parseInput(calendarEventFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const session = await requireSession();
  const school = findSchool(session, v.schoolId);
  if (!school) return fail('forbidden');

  const row = {
    event_type: v.eventType,
    title: v.title,
    starts_on: v.startsOn,
    ends_on: v.endsOn,
    start_time: v.startTime,
    end_time: v.endTime,
    affects_schedule: v.affectsSchedule,
    notes: v.notes,
  };
  const supabase = await createSupabaseServerClient();
  const { error } = eventId
    ? await supabase.from('school_calendar_events').update(row).eq('id', eventId)
    : await supabase
        .from('school_calendar_events')
        .insert({ ...row, board_id: school.boardId, school_id: school.id, class_id: v.classId });
  if (error) return fail(reportError('saveCalendarEvent', error));
  revalidatePath('/calendar');
  revalidatePath('/today');
  return okVoid();
}

export async function deleteCalendarEvent(eventId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('school_calendar_events')
    .delete()
    .eq('id', eventId)
    .select('id');
  if (error) return fail(reportError('deleteCalendarEvent', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/calendar');
  revalidatePath('/today');
  return okVoid();
}
