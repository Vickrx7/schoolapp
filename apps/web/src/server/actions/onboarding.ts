'use server';

import { CURRENT_TERMS_VERSION, SAMPLE_GRADES, buildSampleClass, localDateIn } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { welcomeNext } from '@/lib/request-path';
import { reportError } from '../errors';
import { landingFor, requireSession, teachingSchools } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Bienvenue » and « Pour bien commencer » (DECISIONS D-109, D-110): accepting the pilot terms
 * (with the profile at a first sign-in), the sample class, and hiding the checklist.
 */

const welcomeSchema = z.object({
  /** The version the page showed: accepting is accepting that text (checked below). */
  version: z.string().max(40),
  /** The profile, at a first sign-in only (absent when newer terms are accepted again). */
  profile: z
    .object({
      displayName: z.string().trim().min(1, 'required').max(120, 'tooLong'),
      honorific: z
        .string()
        .trim()
        .max(20, 'tooLong')
        .transform((s) => s || null),
    })
    .optional(),
  next: z.string().max(2000).nullable().optional(),
});

/**
 * « Commencer » / « Accepter les conditions »: the profile first (so a refusal leaves the person
 * on « Bienvenue » with nothing half done), then `accept_terms`, which records the version and
 * time and audits `user.terms_accepted` for the operator. Answers where to go next.
 */
export async function acceptTerms(
  input: z.input<typeof welcomeSchema>,
): Promise<ActionResult<{ next: string }>> {
  const parsed = parseInput(welcomeSchema, input);
  if (!parsed.ok) return parsed.result;
  // Terms published while the page was open: the person reads the new text first.
  if (parsed.data.version !== CURRENT_TERMS_VERSION) return fail('invalid');
  const session = await requireSession({ beforeTerms: true });
  const supabase = await createSupabaseServerClient();
  const { profile } = parsed.data;
  if (profile) {
    const { error } = await supabase
      .from('users')
      .update({ display_name: profile.displayName, honorific: profile.honorific })
      .eq('id', session.userId);
    if (error) return fail(reportError('acceptTerms.profile', error));
  }
  const { error } = await supabase.rpc('accept_terms', { p_version: parsed.data.version });
  if (error) return fail(reportError('acceptTerms', error));
  revalidatePath('/', 'layout');
  return ok({ next: welcomeNext(parsed.data.next) ?? landingFor(session) });
}

const sampleSchema = z.object({
  schoolId: z.uuid(),
  grade: z.enum(SAMPLE_GRADES),
});

/**
 * « Essayer avec une classe exemple » (D-109): builds the class for the school's calendar and
 * schedule (`buildSampleClass`) and saves it as the teacher (`create_sample_class`, security
 * invoker). One per school (`sampleClassExists`); a board without a school year has none.
 */
export async function createSampleClass(
  input: z.input<typeof sampleSchema>,
): Promise<ActionResult<{ classId: string }>> {
  const parsed = parseInput(sampleSchema, input);
  if (!parsed.ok) return parsed.result;
  const session = await requireSession();
  const school = teachingSchools(session).find((s) => s.id === parsed.data.schoolId);
  if (!school) return fail('forbidden');
  const payload = buildSampleClass({
    gradeCode: parsed.data.grade,
    today: localDateIn(school.timezone),
    dayCount: school.scheduleType === 'cycle' ? (school.cycleLength ?? 5) : 5,
  });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_sample_class', {
    p_school_id: school.id,
    p_sample: payload,
  });
  if (error) {
    return fail(
      error.code === '23505' ? 'sampleClassExists' : reportError('createSampleClass', error),
    );
  }
  revalidatePath('/', 'layout');
  return ok({ classId: data });
}

/**
 * « Supprimer la classe exemple »: the teacher's own sample class only (a real class is deleted
 * from its settings, with its name typed). Logged for the operator only (`sample_class.deleted`).
 */
export async function deleteSampleClass(classId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(classId).success) return fail('invalid');
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('classes')
    .delete()
    .eq('id', classId)
    .eq('sample_owner_id', session.userId)
    .select('id');
  if (error) return fail(reportError('deleteSampleClass', error));
  if (!data?.length) return fail('notFound');
  revalidatePath('/', 'layout');
  return okVoid();
}

/** « Masquer » (or show again) the checklist on « Aujourd'hui » (`onboarding_dismissed_at`). */
export async function setOnboardingHidden(hidden: boolean): Promise<ActionResult> {
  if (typeof hidden !== 'boolean') return fail('invalid');
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('users')
    .update({ onboarding_dismissed_at: hidden ? new Date().toISOString() : null })
    .eq('id', session.userId);
  if (error) return fail(reportError('setOnboardingHidden', error));
  revalidatePath('/today');
  revalidatePath('/demarrage');
  return okVoid();
}
