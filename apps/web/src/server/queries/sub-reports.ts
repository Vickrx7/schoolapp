import 'server-only';
import {
  absenceParts,
  composeSubPlan,
  defaultConfirmDecisions,
  formalStaffName,
  localDateSchema,
  reportableLessons,
  subReportContentSchema,
  type AbsencePart,
  type ConfirmDecision,
  type LocalDate,
  type ReportableLesson,
  type SubReportContent,
  type SubReportNotes,
  type SubReportOutcome,
} from '@lynx/domain';
import { z } from 'zod';
import { parseKeyRing } from '../alerts-crypto';
import { serverEnv } from '../env';
import type { SessionContext } from '../session';
import { decryptReportNotes } from '../sub-reports/notes';
import { createSupabaseServerClient } from '../supabase';
import { loadPlanForOwner, type OwnerPlan } from './sub-plans';

/**
 * The substitute's end-of-day report as the absent teacher confirms it and as the direction
 * reads it (DECISIONS D-054, D-056). The owner reads through RLS (a draft only once the day's
 * access has ended); the direction through get_sub_report_for_staff, which audits every view.
 * The notes are decrypted here, on the server, and never logged.
 */

export type ReportStatus = 'draft' | 'submitted' | 'confirmed';
export type ProgressState = 'completed' | 'skipped' | 'pending_confirmation';

export interface ReportLessonView {
  lessonId: string;
  title: string;
  sequenceNumber: number;
  unitTitle: string;
  className: string;
  /** The lesson's time in the plan, when the plan has it. */
  start: string | null;
  end: string | null;
  /** What the substitute said (null: the report does not mention it). */
  outcome: SubReportOutcome | null;
  /** The substitute's note for the lesson's block. */
  note: string | null;
  /** The lesson's progress now (owner only): from this report, or her own record. */
  progress: ProgressState | null;
  /** Recorded by the teacher herself (or another report): confirming leaves it as it is. */
  recordedElsewhere: boolean;
  /** Preselected on the confirmation page. */
  decision: ConfirmDecision;
}

/** Whether the notes can be shown: none written, purged after 60 days, or undecryptable. */
export type NotesState = 'ok' | 'none' | 'purged' | 'unreadable';

export interface ReportView {
  reportId: string;
  status: ReportStatus;
  submittedAt: string | null;
  updatedAt: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
  lessons: ReportLessonView[];
  absent: { id: string; firstName: string }[];
  notes: SubReportNotes | null;
  notesState: NotesState;
}

export interface OwnerReportPage {
  plan: OwnerPlan;
  report: ReportView | null;
  /** The day's access has ended: no report can arrive any more. */
  windowEnded: boolean;
  /** Planned lessons the report does not mention (all of them when there is no report). */
  unreported: ReportableLesson[];
}

function alertsRing() {
  try {
    return parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
  } catch {
    return null;
  }
}

function readNotes(
  ciphertext: string | null,
  purgedAt: string | null,
  planId: string,
): { notes: SubReportNotes | null; notesState: NotesState } {
  if (purgedAt) return { notes: null, notesState: 'purged' };
  if (!ciphertext) return { notes: null, notesState: 'none' };
  const ring = alertsRing();
  const notes = ring ? decryptReportNotes(ciphertext, planId, ring) : null;
  return { notes, notesState: notes ? 'ok' : 'unreadable' };
}

const defaultDecision = (outcome: SubReportOutcome | null): ConfirmDecision =>
  outcome === 'done' ? 'completed' : 'not_completed';

/**
 * A plan's report for its owner, with what the confirmation page needs. Null when the plan is
 * not hers (or does not exist).
 */
export async function loadReportForOwner(
  session: SessionContext,
  planId: string,
): Promise<OwnerReportPage | null> {
  const plan = await loadPlanForOwner(session, planId);
  if (!plan) return null;
  const supabase = await createSupabaseServerClient();
  const [reportRes, endedRes] = await Promise.all([
    supabase
      .from('sub_reports')
      .select(
        'id, status, content, notes_ciphertext, notes_purged_at, submitted_at, updated_at, confirmed_at, confirmed_by',
      )
      .eq('sub_plan_id', planId)
      .maybeSingle(),
    supabase.rpc('sub_plan_access_ended', { p_plan_id: planId }),
  ]);
  const windowEnded = endedRes.data === true;
  const composed = plan.plan
    ? composeSubPlan(plan.plan, { edits: plan.edits, audience: 'owner' })
    : null;
  const planned = composed ? reportableLessons(composed) : [];
  const row = reportRes.data;
  if (!row) return { plan, report: null, windowEnded, unreported: planned };

  const parsed = subReportContentSchema.safeParse(row.content);
  const content: SubReportContent = parsed.success
    ? parsed.data
    : { schemaVersion: 1, lessons: [], absentStudentIds: [] };
  const { notes, notesState } = readNotes(row.notes_ciphertext, row.notes_purged_at, planId);

  // The lessons the report names, and any pending row it wrote (read as the teacher: RLS).
  const { data: pendingRows } = await supabase
    .from('lesson_progress')
    .select('lesson_id')
    .eq('sub_report_id', row.id);
  const lessonIds = [
    ...new Set([
      ...content.lessons.map((l) => l.lessonId),
      ...(pendingRows ?? []).map((p) => p.lesson_id),
    ]),
  ];
  const [lessonsRes, progressRes, studentsRes] = await Promise.all([
    lessonIds.length
      ? supabase
          .from('unit_lessons')
          .select('id, title, sequence_number, units!inner(title, classes!inner(name))')
          .in('id', lessonIds)
      : Promise.resolve({ data: [] }),
    lessonIds.length
      ? supabase
          .from('lesson_progress')
          .select('lesson_id, status, sub_report_id')
          .in('lesson_id', lessonIds)
      : Promise.resolve({ data: [] }),
    content.absentStudentIds.length
      ? supabase.from('students').select('id, first_name').in('id', content.absentStudentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const outcomeOf = new Map(content.lessons.map((l) => [l.lessonId, l]));
  const inPlan = new Map(planned.map((l) => [l.lessonId, l]));
  const progress = new Map((progressRes.data ?? []).map((p) => [p.lesson_id, p]));
  const preselected = new Map(
    composed ? defaultConfirmDecisions(composed, content).map((d) => [d.lessonId, d.decision]) : [],
  );
  const order = (id: string) => {
    const i = planned.findIndex((l) => l.lessonId === id);
    return i === -1 ? planned.length : i;
  };

  const lessons: ReportLessonView[] = (lessonsRes.data ?? [])
    .map((l) => {
      const reported = outcomeOf.get(l.id);
      const planLesson = inPlan.get(l.id);
      const p = progress.get(l.id);
      const outcome = reported?.outcome ?? (p?.sub_report_id === row.id ? 'done' : null);
      return {
        lessonId: l.id,
        title: l.title,
        sequenceNumber: l.sequence_number,
        unitTitle: l.units.title,
        className: l.units.classes.name,
        start: planLesson?.start ?? null,
        end: planLesson?.end ?? null,
        outcome,
        note: (reported && notes?.lessonNotes[reported.blockKey]) || null,
        progress: p?.status ?? null,
        recordedElsewhere: !!p && p.sub_report_id !== row.id,
        decision: preselected.get(l.id) ?? defaultDecision(outcome),
      };
    })
    .sort((a, b) => order(a.lessonId) - order(b.lessonId) || a.title.localeCompare(b.title));

  const names = new Map((studentsRes.data ?? []).map((s) => [s.id, s.first_name]));
  return {
    plan,
    windowEnded,
    unreported: planned.filter((l) => !outcomeOf.has(l.lessonId)),
    report: {
      reportId: row.id,
      status: row.status,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      // Only the owner confirms her reports.
      confirmedByName:
        row.confirmed_by === session.userId
          ? formalStaffName(session.displayName, session.honorific)
          : null,
      lessons,
      absent: content.absentStudentIds.flatMap((id) => {
        const firstName = names.get(id);
        return firstName ? [{ id, firstName }] : [];
      }),
      notes,
      notesState,
    },
  };
}

const staffReportSchema = z.object({
  planId: z.string(),
  absenceId: z.string(),
  planDate: localDateSchema,
  part: z.enum(absenceParts),
  teacherName: z.string(),
  report: z
    .object({
      reportId: z.string(),
      status: z.enum(['draft', 'submitted', 'confirmed']),
      submittedAt: z.string().nullable(),
      updatedAt: z.string(),
      confirmedAt: z.string().nullable(),
      confirmedByName: z.string().nullable(),
      content: z.unknown(),
      notesCiphertext: z.string().nullable(),
      notesPurgedAt: z.string().nullable(),
    })
    .nullable(),
  lessons: z.array(
    z.object({
      lessonId: z.string(),
      title: z.string(),
      sequenceNumber: z.number().int(),
      unitTitle: z.string(),
      className: z.string(),
    }),
  ),
  students: z.array(z.object({ id: z.string(), firstName: z.string() })),
});

export interface StaffReportPage {
  absenceId: string;
  planDate: LocalDate;
  part: AbsencePart;
  teacherName: string;
  report: ReportView | null;
}

/**
 * A day's report for the direction, read-only (get_sub_report_for_staff audits the view). Null
 * when the caller is not the school's direction or the plan does not exist.
 */
export async function loadReportForStaff(planId: string): Promise<StaffReportPage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_sub_report_for_staff', { p_plan_id: planId });
  if (error || !data) return null;
  const parsed = staffReportSchema.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (!d.report) {
    return {
      absenceId: d.absenceId,
      planDate: d.planDate,
      part: d.part,
      teacherName: d.teacherName,
      report: null,
    };
  }
  const content = subReportContentSchema.safeParse(d.report.content);
  const reported = content.success ? content.data.lessons : [];
  const { notes, notesState } = readNotes(d.report.notesCiphertext, d.report.notesPurgedAt, planId);
  const titles = new Map(d.lessons.map((l) => [l.lessonId, l]));
  const names = new Map(d.students.map((s) => [s.id, s.firstName]));
  return {
    absenceId: d.absenceId,
    planDate: d.planDate,
    part: d.part,
    teacherName: d.teacherName,
    report: {
      reportId: d.report.reportId,
      status: d.report.status,
      submittedAt: d.report.submittedAt,
      updatedAt: d.report.updatedAt,
      confirmedAt: d.report.confirmedAt,
      confirmedByName: d.report.confirmedByName,
      lessons: reported.flatMap((r) => {
        const l = titles.get(r.lessonId);
        if (!l) return [];
        return [
          {
            lessonId: r.lessonId,
            title: l.title,
            sequenceNumber: l.sequenceNumber,
            unitTitle: l.unitTitle,
            className: l.className,
            start: null,
            end: null,
            outcome: r.outcome,
            note: notes?.lessonNotes[r.blockKey] || null,
            progress: null,
            recordedElsewhere: false,
            decision: defaultDecision(r.outcome),
          },
        ];
      }),
      absent: (content.success ? content.data.absentStudentIds : []).flatMap((id) => {
        const firstName = names.get(id);
        return firstName ? [{ id, firstName }] : [];
      }),
      notes,
      notesState,
    },
  };
}

export interface PendingReport {
  reportId: string;
  planId: string;
  absenceId: string;
  planDate: LocalDate;
  status: 'draft' | 'submitted';
}

/**
 * The signed-in teacher's reports waiting for her confirmation (the Aujourd'hui banner): sent,
 * or unsent drafts once their day is over (RLS decides which drafts she can see).
 */
export async function loadPendingReports(): Promise<PendingReport[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('sub_reports')
    .select('id, status, sub_plans!inner(id, plan_date, absence_id)')
    .in('status', ['draft', 'submitted'])
    .order('updated_at', { ascending: false })
    .limit(5);
  return (data ?? [])
    .map((r) => ({
      reportId: r.id,
      planId: r.sub_plans.id,
      absenceId: r.sub_plans.absence_id,
      planDate: r.sub_plans.plan_date,
      status: r.status as 'draft' | 'submitted',
    }))
    .sort((a, b) => a.planDate.localeCompare(b.planDate));
}
