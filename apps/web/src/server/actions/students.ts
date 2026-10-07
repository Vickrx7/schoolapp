'use server';

import { firstNameSchema, studentAlertFormSchema, studentImportSchema } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { decryptAlert, encryptAlert, parseKeyRing } from '../alerts-crypto';
import { serverEnv } from '../env';
import { reportError } from '../errors';
import { requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

const studentsPath = (classId: string) => `/classes/${classId}/students`;

/** Adds students by first name only (the only student field we store). */
export async function addStudents(
  input: z.input<typeof studentImportSchema>,
): Promise<ActionResult<{ count: number }>> {
  await requireSession();
  const parsed = parseInput(studentImportSchema, input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('students')
    .insert(
      parsed.data.firstNames.map((first_name) => ({ class_id: parsed.data.classId, first_name })),
    )
    .select('id');
  if (error) return fail(reportError('addStudents', error));
  revalidatePath(studentsPath(parsed.data.classId));
  return ok({ count: data?.length ?? 0 });
}

const updateSchema = z.object({
  firstName: firstNameSchema.optional(),
  defaultLanguageLevelId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateStudent(
  classId: string,
  studentId: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = parseInput(updateSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('students')
    .update({
      ...(v.firstName !== undefined ? { first_name: v.firstName } : {}),
      ...(v.defaultLanguageLevelId !== undefined
        ? { default_language_level_id: v.defaultLanguageLevelId }
        : {}),
      ...(v.active !== undefined ? { active: v.active } : {}),
    })
    .eq('id', studentId)
    .select('id');
  if (error) return fail(reportError('updateStudent', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath(studentsPath(classId));
  return okVoid();
}

export async function deleteStudent(classId: string, studentId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from('students').delete().eq('id', studentId).select('id');
  if (error) return fail(reportError('deleteStudent', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath(studentsPath(classId));
  return okVoid();
}

/** Encrypts the alert text on the server, then stores it through the audited function. */
export async function saveStudentAlert(
  classId: string,
  input: z.input<typeof studentAlertFormSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  const parsed = parseInput(studentAlertFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const ring = parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
  if (!ring) return fail('alertsKeyMissing');

  const v = parsed.data;
  const { ciphertext, keyVersion } = encryptAlert(v.text, v.studentId, ring);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('save_student_alert', {
    p_student_id: v.studentId,
    p_category: v.category,
    p_body_ciphertext: ciphertext,
    p_key_version: keyVersion,
    ...(v.alertId ? { p_alert_id: v.alertId } : {}),
  });
  if (error || !data) return fail(reportError('saveStudentAlert', error));
  revalidatePath(studentsPath(classId));
  return ok({ id: data });
}

export async function deleteStudentAlert(classId: string, alertId: string): Promise<ActionResult> {
  await requireSession();
  if (!z.uuid().safeParse(alertId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('delete_student_alert', { p_alert_id: alertId });
  if (error) return fail(reportError('deleteStudentAlert', error));
  revalidatePath(studentsPath(classId));
  return okVoid();
}

export interface StudentAlertView {
  alertId: string;
  studentId: string;
  category: 'allergy' | 'medical' | 'safety' | 'other';
  text: string | null;
}

/**
 * Reveals the class's alerts on request (hidden by default so they never appear on a
 * projected screen by accident). Each call is logged in the audit log by the database.
 */
export async function revealClassAlerts(
  classId: string,
): Promise<ActionResult<StudentAlertView[]>> {
  await requireSession();
  if (!z.uuid().safeParse(classId).success) return fail('invalid');
  const ring = parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
  if (!ring) return fail('alertsKeyMissing');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_class_alerts', { p_class_id: classId });
  if (error) return fail(reportError('revealClassAlerts', error));
  return ok(
    (data ?? []).map((a) => {
      let text: string | null = null;
      try {
        text = decryptAlert(a.body_ciphertext, a.student_id, ring);
      } catch {
        text = null; // shown as "cannot be decrypted"
      }
      return { alertId: a.alert_id, studentId: a.student_id, category: a.category, text };
    }),
  );
}
