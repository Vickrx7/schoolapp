'use server';

import {
  buildNewsletterDraft,
  formalStaffName,
  mergeRefill,
  newsletterContentSchema,
  newsletterItemId,
  type NewsletterContent,
} from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { newsletterNames, type NewsletterNames } from '../newsletter/names';
import { newsletterCatalogs } from '../newsletter/catalogs';
import { newsletterPhrasePair } from '../newsletter/phrases';
import { isWeekOf } from '../newsletter/view-model';
import { loadClass } from '../queries/classes';
import { loadNewsletterFacts, loadRoster, type NewsletterOptions } from '../queries/newsletters';
import { findSchool, hasModule, requireSession, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Info-parents » (DECISIONS D-136 to D-138): preparing, saving, preparing again, marking sent
 * and deleting a class's message to families. Every action gates through the session first
 * (D-109); row level security (the class team) and the database's checks (LXN01, LXN02) decide in
 * the end. Nothing is sent to families, and no text is ever logged: errors carry codes only.
 */

const uuid = z.uuid();

const optionsSchema = z.object({
  colleagues: z.boolean(),
  faith: z.boolean(),
  guides: z.boolean(),
});
export type NewsletterOptionsInput = z.input<typeof optionsSchema>;

const refresh = (classId: string, weekOf?: string) => {
  revalidatePath(`/classes/${classId}/info-parents`);
  if (weekOf) revalidatePath(`/classes/${classId}/info-parents/${weekOf}`);
};

/** Both languages' sentences, whatever the interface's language. */
const phrases = async () => newsletterPhrasePair(await newsletterCatalogs());

/** The first draft of a week's message (`newsletterFacts`, then `buildNewsletterDraft`). */
async function draftFor(
  session: SessionContext,
  classId: string,
  weekOf: string,
  options: NewsletterOptions,
): Promise<ActionResult<{ content: NewsletterContent; classId: string }>> {
  const cls = await loadClass(session, classId);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  if (!cls?.myRole || !school || !hasModule(school, 'teaching')) return fail('forbidden');
  // The guides are the library's (D-061): only at a school with the Library module.
  const effective = { ...options, guides: options.guides && hasModule(school, 'library') };
  const facts = await loadNewsletterFacts(session, cls, weekOf, effective);
  if (!facts) return fail('unexpected');
  const content = buildNewsletterDraft(
    facts,
    await phrases(),
    {
      signature: formalStaffName(session.displayName, session.honorific).slice(0, 120),
      faith: effective.faith,
      guides: effective.guides,
    },
    () => newsletterItemId(),
  );
  return ok({ content, classId: cls.id });
}

/**
 * « Préparer le message » (D-137): the week's first draft, from the class's data. A message that
 * already exists for the week (a colleague was quicker) is opened instead.
 */
export async function createNewsletter(
  classId: string,
  weekOf: string,
  options: NewsletterOptionsInput,
): Promise<ActionResult<{ weekOf: string }>> {
  const session = await requireSession();
  if (!uuid.safeParse(classId).success || typeof weekOf !== 'string' || !isWeekOf(weekOf)) {
    return fail('invalid');
  }
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success) return fail('invalid');
  const draft = await draftFor(session, classId, weekOf, parsed.data);
  if (!draft.ok) return draft;
  const checked = newsletterContentSchema.safeParse(draft.data.content);
  if (!checked.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('class_newsletters')
    .insert({ class_id: classId, week_of: weekOf, content: checked.data });
  if (error && error.code !== '23505') return fail(reportError('createNewsletter', error));
  refresh(classId, weekOf);
  return ok({ weekOf });
}

/** What saving answers: the new revision and what the names check found in the saved message. */
export interface SavedNewsletter {
  revision: number;
  names: NewsletterNames;
}

/**
 * « Enregistrer » (D-137): the whole content, on the revision the editor started from. Zero rows:
 * a colleague saved in between (`newsletterConflict`), or the message is gone.
 */
export async function saveNewsletter(
  id: string,
  expectedRevision: number,
  content: z.input<typeof newsletterContentSchema>,
): Promise<ActionResult<SavedNewsletter>> {
  await requireSession();
  if (!uuid.safeParse(id).success || !Number.isInteger(expectedRevision)) return fail('invalid');
  const parsed = parseInput(newsletterContentSchema, content);
  if (!parsed.ok) return parsed.result;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_newsletters')
    .update({ content: parsed.data })
    .eq('id', id)
    .eq('revision', expectedRevision)
    .select('revision, class_id, week_of');
  if (error) return fail(reportError('saveNewsletter', error));
  const row = data?.[0];
  if (!row) return fail(await missingOrConflict(id));
  refresh(row.class_id, row.week_of);
  return ok({
    revision: row.revision,
    names: newsletterNames(parsed.data, await loadRoster(row.class_id)),
  });
}

/**
 * « Préremplir à nouveau » (D-137): the app's paragraphs prepared again from today's data; the
 * typed ones, the signature and the removed sections stay (`mergeRefill`). The editor saves first.
 */
export async function refillNewsletter(
  id: string,
  expectedRevision: number,
  options: NewsletterOptionsInput,
): Promise<ActionResult<SavedNewsletter & { content: NewsletterContent }>> {
  const session = await requireSession();
  if (!uuid.safeParse(id).success || !Number.isInteger(expectedRevision)) return fail('invalid');
  const parsedOptions = optionsSchema.safeParse(options);
  if (!parsedOptions.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: current, error: readError } = await supabase
    .from('class_newsletters')
    .select('class_id, week_of, revision, content')
    .eq('id', id)
    .maybeSingle();
  if (readError) return fail(reportError('refillNewsletter', readError));
  if (!current) return fail('notFound');
  if (current.revision !== expectedRevision) return fail('newsletterConflict');
  const stored = newsletterContentSchema.safeParse(current.content);
  if (!stored.success) return fail('invalid');
  const draft = await draftFor(session, current.class_id, current.week_of, parsedOptions.data);
  if (!draft.ok) return draft;
  const merged = newsletterContentSchema.safeParse(mergeRefill(stored.data, draft.data.content));
  if (!merged.success) return fail('invalid');
  const { data, error } = await supabase
    .from('class_newsletters')
    .update({ content: merged.data })
    .eq('id', id)
    .eq('revision', expectedRevision)
    .select('revision');
  if (error) return fail(reportError('refillNewsletter', error));
  if (!data?.[0]) return fail(await missingOrConflict(id));
  refresh(current.class_id, current.week_of);
  return ok({
    revision: data[0].revision,
    content: merged.data,
    names: newsletterNames(merged.data, await loadRoster(current.class_id)),
  });
}

/**
 * « Marquer comme envoyé » / « Remettre en brouillon » (D-136); the « Aujourd'hui » reminder
 * reads it (slice S2).
 */
export async function markNewsletterSent(id: string, sent: boolean): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success || typeof sent !== 'boolean') return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_newsletters')
    .update({ status: sent ? 'sent' : 'draft' })
    .eq('id', id)
    .select('class_id, week_of');
  if (error) return fail(reportError('markNewsletterSent', error));
  const row = data?.[0];
  if (!row) return fail('notFound');
  refresh(row.class_id, row.week_of);
  revalidatePath('/today');
  return okVoid();
}

/** « Supprimer » (D-138: deletable at any time). */
export async function deleteNewsletter(id: string): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_newsletters')
    .delete()
    .eq('id', id)
    .select('class_id, week_of');
  if (error) return fail(reportError('deleteNewsletter', error));
  const row = data?.[0];
  if (!row) return fail('notFound');
  refresh(row.class_id, row.week_of);
  revalidatePath('/today');
  return okVoid();
}

/** A save that changed nothing: the message is still there (a colleague's save) or gone. */
async function missingOrConflict(id: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('class_newsletters').select('id').eq('id', id).maybeSingle();
  return data ? 'newsletterConflict' : 'notFound';
}
