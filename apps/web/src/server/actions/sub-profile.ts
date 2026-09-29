'use server';

import { classSubProfileSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

export type ClassSubProfileInput = z.input<typeof classSubProfileSchema>;

/**
 * Saves a class's « Fiche de suppléance » (D-057). Class team only (RLS); the database checks
 * that the neighbouring colleague is an active teacher at the school. The plans of upcoming
 * absences pick the change up on their own (the Fiche is one of their sources).
 */
export async function saveClassSubProfile(input: ClassSubProfileInput): Promise<ActionResult> {
  await requireSession();
  const parsed = parseInput(classSubProfileSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const fields = {
    arrival_notes: v.arrivalNotes,
    routines_notes: v.routinesNotes,
    classroom_management_notes: v.classroomManagementNotes,
    dismissal_notes: v.dismissalNotes,
    fallback_activities: v.fallbackActivities,
    neighbour_teacher_id: v.neighbourTeacherId,
    neighbour_note: v.neighbourNote,
  };

  const supabase = await createSupabaseServerClient();
  // Update first: the grants allow updating the notes but never the class of a Fiche, so an
  // upsert (which would also set class_id) is not possible.
  const updated = await supabase
    .from('class_sub_profiles')
    .update(fields)
    .eq('class_id', v.classId)
    .select('class_id');
  if (updated.error) return fail(reportError('saveClassSubProfile', updated.error));
  if (!updated.data?.length) {
    const inserted = await supabase
      .from('class_sub_profiles')
      .insert({ class_id: v.classId, ...fields })
      .select('class_id');
    if (inserted.error) {
      // Saved from another device in the meantime: update that row instead.
      if (inserted.error.code !== '23505') {
        return fail(reportError('saveClassSubProfile', inserted.error));
      }
      const retry = await supabase
        .from('class_sub_profiles')
        .update(fields)
        .eq('class_id', v.classId)
        .select('class_id');
      if (retry.error) return fail(reportError('saveClassSubProfile', retry.error));
      if (!retry.data?.length) return fail('forbidden');
    } else if (!inserted.data?.length) {
      return fail('forbidden');
    }
  }
  revalidatePath(`/classes/${v.classId}/substitute`);
  return okVoid();
}
