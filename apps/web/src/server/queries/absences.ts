import 'server-only';
import {
  addDays,
  defaultAbsenceDate,
  isInstructionalDay,
  localDateIn,
  localMinutesIn,
  nextInstructionalDays,
  subPlanV1Schema,
  timeToMinutes,
  type AbsencePart,
  type CalendarEvent,
  type LocalDate,
} from '@lynx/domain';
import type { AbsenceFormSchool } from '@/components/absences/types';
import type { SchoolContext, SessionContext } from '../session';
import { teachingSchools } from '../session';
import { summarizePlan, type PlanDaySummary } from '../sub-plans/summary';
import { createSupabaseServerClient } from '../supabase';
import { eventsForSchool, toCalendarEvent } from './mappers';

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AbsencePlanRow {
  id: string;
  planDate: LocalDate;
  /** Released by hand, or ready and past its review deadline (D-047: computed, not stored). */
  released: boolean;
  /** When it was (or will be) released: released_at, else the review deadline. */
  releaseAt: string;
  releasedByHand: boolean;
  contentVersion: number;
  /** Null in lists, or when the stored plan cannot be read. */
  summary: PlanDaySummary | null;
  /** The classes and rooms the plan covers, as shown in it (empty in lists). */
  classNames: string[];
  roomNames: string[];
}

export interface AbsenceRow {
  id: string;
  schoolId: string;
  teacherId: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
  part: AbsencePart;
  note: string | null;
  status: 'draft' | 'published' | 'cancelled';
  catholicConnection: boolean;
  /** Something the plans were built from changed and they are being rebuilt (D-047). */
  refreshing: boolean;
  isOwner: boolean;
  /** The owner's plans, one per school day (other readers get none: sub_plans RLS). */
  plans: AbsencePlanRow[];
}

type PlanFields = {
  id: string;
  plan_date: string;
  status: string;
  review_deadline: string;
  released_at: string | null;
  content_version: number;
  plan?: unknown;
};

function toPlanRow(p: PlanFields, now: Date): AbsencePlanRow {
  const parsed = p.plan === undefined ? null : subPlanV1Schema.safeParse(p.plan);
  return {
    id: p.id,
    planDate: p.plan_date,
    released:
      p.status === 'released' || (p.status === 'ready' && new Date(p.review_deadline) <= now),
    releaseAt: p.status === 'released' && p.released_at ? p.released_at : p.review_deadline,
    releasedByHand: p.status === 'released',
    contentVersion: p.content_version,
    summary: parsed?.success ? summarizePlan(parsed.data) : null,
    classNames: parsed?.success ? parsed.data.classes.map((c) => c.name) : [],
    roomNames: parsed?.success
      ? [...new Set(parsed.data.classes.map((c) => c.roomName).filter((r): r is string => !!r))]
      : [],
  };
}

const ABSENCE_FIELDS =
  'id, school_id, teacher_id, starts_on, ends_on, part, note, status, catholic_connection, sources_changed_at';

type AbsenceFields = {
  id: string;
  school_id: string;
  teacher_id: string;
  starts_on: string;
  ends_on: string;
  part: AbsencePart;
  note: string | null;
  status: 'draft' | 'published' | 'cancelled';
  catholic_connection: boolean;
  sources_changed_at: string | null;
};

function toAbsenceRow(
  session: SessionContext,
  a: AbsenceFields,
  plans: PlanFields[],
  now: Date,
): AbsenceRow {
  return {
    id: a.id,
    schoolId: a.school_id,
    teacherId: a.teacher_id,
    startsOn: a.starts_on,
    endsOn: a.ends_on,
    part: a.part,
    note: a.note,
    status: a.status,
    catholicConnection: a.catholic_connection,
    refreshing: a.sources_changed_at !== null,
    isOwner: a.teacher_id === session.userId,
    plans: plans.map((p) => toPlanRow(p, now)).sort((x, y) => x.planDate.localeCompare(y.planDate)),
  };
}

/**
 * The signed-in teacher's published absences that end on or after `from` (her own only, even
 * for direction: this is « Mes absences »), with each day's release status.
 */
export async function loadMyAbsences(
  session: SessionContext,
  options: { from: LocalDate; to?: LocalDate; limit?: number; ascending?: boolean },
): Promise<AbsenceRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('absences')
    .select(
      `${ABSENCE_FIELDS}, sub_plans(id, plan_date, status, review_deadline, released_at, content_version)`,
    )
    .eq('teacher_id', session.userId)
    .eq('status', 'published')
    .gte('ends_on', options.from);
  if (options.to) query = query.lt('ends_on', options.to);
  const { data } = await query
    .order('starts_on', { ascending: options.ascending ?? true })
    .limit(options.limit ?? 20);
  const now = new Date();
  return (data ?? []).map((a) => toAbsenceRow(session, a, a.sub_plans, now));
}

/**
 * One absence (null if not visible: RLS lets the owner, direction and office read it), with
 * the owner's plans and a summary of each day.
 */
export async function loadAbsence(
  session: SessionContext,
  absenceId: string,
): Promise<AbsenceRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('absences')
    .select(
      `${ABSENCE_FIELDS}, sub_plans(id, plan_date, status, review_deadline, released_at, content_version, plan)`,
    )
    .eq('id', absenceId)
    .maybeSingle();
  if (!data) return null;
  return toAbsenceRow(session, data, data.sub_plans, new Date());
}

/** School-wide calendar events (board and school) that overlap a date range. */
export async function loadSchoolEvents(
  supabase: Supabase,
  school: SchoolContext,
  from: LocalDate,
  to: LocalDate,
): Promise<CalendarEvent[]> {
  const { data } = await supabase
    .from('school_calendar_events')
    .select(
      'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
    )
    .is('class_id', null)
    .lte('starts_on', to)
    .gte('ends_on', from);
  return eventsForSchool(data ?? [], school).map(toCalendarEvent);
}

/** How far ahead calendar events are read for the date chips. */
const FORM_HORIZON_DAYS = 60;

/** Per teaching school: today, the next school day and the date the form preselects. */
export async function loadAbsenceFormContext(
  session: SessionContext,
): Promise<AbsenceFormSchool[]> {
  const schools = teachingSchools(session);
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  return Promise.all(
    schools.map(async (school) => {
      const today = localDateIn(school.timezone, now);
      const events = await loadSchoolEvents(
        supabase,
        school,
        today,
        addDays(today, FORM_HORIZON_DAYS),
      );
      const dayEnd = school.settings.dayEnd;
      const todayOpen =
        isInstructionalDay(today, events) &&
        localMinutesIn(school.timezone, now) < timeToMinutes(dayEnd);
      const tomorrow = addDays(today, 1);
      const nextSchoolDay = nextInstructionalDays(tomorrow, 1, events)[0] ?? tomorrow;
      return {
        id: school.id,
        name: school.name,
        timezone: school.timezone,
        today,
        todayOpen,
        nextSchoolDay,
        defaultDate: defaultAbsenceDate({ now, timezone: school.timezone, dayEnd, events }),
        halfDaySplit: school.settings.substitute.halfDaySplit,
      };
    }),
  );
}
