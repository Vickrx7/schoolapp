'use server';

import { isLibraryItemType } from '@lynx/content';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { liveStateSchema, type LiveState } from '../class-portal/schemas';
import { classPortalConfigured } from '../class-portal/db';
import { quizPreview } from '../class-mode/start-check';
import { reportError } from '../errors';
import { findPersonalInfo } from '../library/share-guard';
import { librarySchools, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * The teacher's side of « Quiz sur les appareils » (DECISIONS D-082 to D-090). The database
 * decides who may do what (`start_class_session`, `class_session_control`,
 * `end_class_session`… check the class team with a teacher role, `app.my_class_ids()`, and the
 * Library module); these actions check the arguments and translate the refusals: LXC01 a session
 * is already open for the class, LXC02 the session changed (another tab, a double click), LXC03
 * no question left, LXC04 not playable on devices, LXC05 the session has ended
 * (`server/errors.ts`). Class mode never uses AI.
 */

const uuid = z.uuid();
const CLASS_TAB = (classId: string) => `/classes/${classId}/class-mode`;

async function classModeSession() {
  const session = await requireSession();
  return librarySchools(session).length ? session : null;
}

// ---------------------------------------------------------------------------------------
// Starting a quiz
// ---------------------------------------------------------------------------------------

export interface QuizStartCheck {
  /** Questions devices will get. */
  questions: number;
  /** Of which count for points. */
  scorable: number;
  /** First names of the class's students found in what devices will show (D-084). */
  possibleNames: string[];
}

/**
 * Before « Lancer »: the questions devices will get and, since a quiz can be the teacher's own
 * private draft, the class's first names found in what devices will show (the title, prompts,
 * hints and options). A warning only: « Lancer quand même » starts anyway.
 */
export async function checkQuizStart(
  itemId: string,
  versionId: string,
  classId: string,
  scoreShortAnswers: boolean,
): Promise<ActionResult<QuizStartCheck>> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (![itemId, versionId, classId].every((id) => uuid.safeParse(id).success)) {
    return fail('invalid');
  }
  if (!classPortalConfigured()) return fail('classPortalNotConfigured');

  const supabase = await createSupabaseServerClient();
  const [version, key, students] = await Promise.all([
    supabase
      .from('library_item_versions')
      .select('id, content, library_items!inner(type, title)')
      .eq('id', versionId)
      .eq('item_id', itemId)
      .maybeSingle(),
    supabase
      .from('library_item_answer_keys')
      .select('answer_key')
      .eq('version_id', versionId)
      .maybeSingle(),
    // Row level security: the students of a class of the teacher's.
    supabase.from('students').select('first_name').eq('class_id', classId),
  ]);
  const error = version.error ?? key.error ?? students.error;
  if (error) return fail(reportError('checkQuizStart', error));
  const item = version.data?.library_items;
  if (!version.data || !item || !isLibraryItemType(item.type)) return fail('notFound');

  const preview = quizPreview({
    type: item.type,
    title: item.title,
    content: version.data.content,
    answerKey: key.data?.answer_key ?? null,
    scoreShortAnswers,
  });
  if (preview.questions === 0) return fail('classModeNotPlayable');
  const findings = findPersonalInfo(
    preview.deviceStrings,
    (students.data ?? []).map((s) => ({ name: s.first_name, kind: 'student' as const })),
  );
  return ok({
    questions: preview.questions,
    scorable: preview.scorable,
    possibleNames: findings.studentNames,
  });
}

const startSchema = z.object({
  classId: uuid,
  versionId: uuid,
  mode: z.enum(['teams', 'solo']),
  teamCount: z.number().int().min(2).max(6),
  teamChoice: z.enum(['random', 'device']),
  /** « Minuterie »: none, 20, 30 or 60 s. */
  seconds: z.union([z.literal(20), z.literal(30), z.literal(60)]).nullable(),
  revealAnswers: z.boolean(),
  scoreShortAnswers: z.boolean(),
  /** « Terminer cette séance et lancer » (a colleague's or a forgotten session). */
  replaceOpen: z.boolean(),
});
export type StartQuizOptions = z.input<typeof startSchema>;

/**
 * « Lancer »: starts a session of one version of the quiz in the class; the database builds the
 * devices' snapshot (a whitelist, never a key) and the grading key. The projector then opens.
 * A join code that collides with another open session's (unique while open) is drawn again once.
 */
export async function startQuiz(
  itemId: string,
  options: StartQuizOptions,
): Promise<ActionResult<{ sessionId: string }>> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  const parsed = startSchema.safeParse(options);
  if (!uuid.safeParse(itemId).success || !parsed.success) return fail('invalid');
  if (!classPortalConfigured()) return fail('classPortalNotConfigured');
  const o = parsed.data;

  const supabase = await createSupabaseServerClient();
  const call = () =>
    supabase.rpc('start_class_session', {
      p_class_id: o.classId,
      p_item_id: itemId,
      p_version_id: o.versionId,
      p_mode: o.mode,
      p_team_count: o.teamCount,
      p_team_choice: o.mode === 'teams' ? o.teamChoice : 'random',
      ...(o.seconds === null ? {} : { p_seconds_per_question: o.seconds }),
      p_reveal_answers: o.revealAnswers,
      p_score_short_answers: o.scoreShortAnswers,
      p_replace_open: o.replaceOpen,
    });
  let { data, error } = await call();
  if (error?.code === '23505') ({ data, error } = await call());
  if (error) return fail(reportError('startQuiz', error));
  const started = data?.[0];
  if (!started) return fail('unexpected');
  revalidatePath(CLASS_TAB(o.classId));
  return ok({ sessionId: started.session_id });
}

// ---------------------------------------------------------------------------------------
// The projector's controls
// ---------------------------------------------------------------------------------------

const ACTIONS = ['next', 'reveal', 'leaderboard', 'finish', 'lock', 'unlock', 'move', 'remove'];
export type SessionAction =
  'next' | 'reveal' | 'leaderboard' | 'finish' | 'lock' | 'unlock' | 'move' | 'remove';

/**
 * One step of the session: « Commencer » and « Question suivante » (next), « Afficher la
 * réponse » (reveal), « Classement », « Terminer » (finish), « Fermer / Rouvrir les
 * inscriptions », « Changer d’équipe » (move) and « Retirer » (remove). `version` is the state
 * the projector shows: a double click or another tab gets LXC02 instead of skipping a question.
 * Returns the projector's new state.
 */
export async function controlSession(
  sessionId: string,
  action: SessionAction,
  version: number,
  participantId?: string,
  team?: string,
): Promise<ActionResult<LiveState>> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (
    !uuid.safeParse(sessionId).success ||
    !ACTIONS.includes(action) ||
    !Number.isInteger(version) ||
    (participantId !== undefined && !uuid.safeParse(participantId).success) ||
    (team !== undefined && !/^[a-z]{2,12}$/.test(team))
  ) {
    return fail('invalid');
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('class_session_control', {
    p_session_id: sessionId,
    p_action: action,
    p_expected_version: version,
    ...(participantId ? { p_participant_id: participantId } : {}),
    ...(team ? { p_team: team } : {}),
  });
  if (error) return fail(reportError('controlSession', error));
  const state = liveStateSchema.safeParse(data);
  if (!state.success) return fail(reportError('controlSession', { message: 'unreadable state' }));
  return ok(state.data);
}

/**
 * « Garder les résultats de la classe (sans noms) », ticked or not while the session runs: the
 * choice also applies if the session expires before the teacher ends it (D-089).
 */
export async function setKeepResults(sessionId: string, keep: boolean): Promise<ActionResult> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(sessionId).success || typeof keep !== 'boolean') return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_class_session_keep', {
    p_session_id: sessionId,
    p_keep: keep,
  });
  if (error) return fail(reportError('setKeepResults', error));
  return okVoid();
}

/**
 * « Terminer la séance »: every answer and device of the session is deleted in one transaction,
 * after the class results are written when kept (D-089). Idempotent.
 */
export async function endSession(
  sessionId: string,
  keep: boolean,
): Promise<ActionResult<{ classId: string | null }>> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(sessionId).success || typeof keep !== 'boolean') return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from('class_sessions')
    .select('class_id')
    .eq('id', sessionId)
    .maybeSingle();
  const { error } = await supabase.rpc('end_class_session', {
    p_session_id: sessionId,
    p_keep: keep,
  });
  if (error) return fail(reportError('endSession', error));
  const classId = row?.class_id ?? null;
  if (classId) revalidatePath(CLASS_TAB(classId));
  return ok({ classId });
}

// ---------------------------------------------------------------------------------------
// The class tab
// ---------------------------------------------------------------------------------------

/** « Supprimer » on kept results: the closed session goes, and its results with it. */
export async function deleteSessionResults(sessionId: string): Promise<ActionResult> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(sessionId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  // Row level security: a closed session of a class of the teacher's (an open one ends first).
  const { data, error } = await supabase
    .from('class_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('status', 'closed')
    .select('id, class_id');
  if (error) return fail(reportError('deleteSessionResults', error));
  if (!data?.length) return fail('notFound');
  revalidatePath(CLASS_TAB(data[0]!.class_id));
  return okVoid();
}

/**
 * « Remplacer le lien »: a new class link; the old one stops working on every device (audited
 * as class_mode_link.replaced). The tab then shows the new link and its QR code.
 */
export async function replaceClassLink(classId: string): Promise<ActionResult> {
  const session = await classModeSession();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(classId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('class_mode_link', {
    p_class_id: classId,
    p_replace: true,
  });
  if (error) return fail(reportError('replaceClassLink', error));
  revalidatePath(CLASS_TAB(classId));
  return okVoid();
}
