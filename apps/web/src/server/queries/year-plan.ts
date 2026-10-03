import 'server-only';
import {
  localDateIn,
  schoolWeeks,
  type LocalDate,
  type PlacementUnit,
  type ReportPeriod,
  type SchoolWeek,
  type YearCalendarEvent,
} from '@lynx/domain';
import { localized } from '@/i18n/config';
import { findSchool, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { fetchAllRows } from './fetch-all';
import type { ClassDetail } from './classes';
import { toCalendarEvent } from './mappers';
import { loadSubjectsForGrades, type SubjectOption } from './subjects';

/**
 * « Mon année » (DECISIONS D-123): what the planning screens read about a class's school year,
 * under row level security as the signed-in teacher.
 */

export interface ClassYear {
  id: string;
  name: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
}

export interface ClassYearWeeks {
  year: ClassYear;
  /** Monday to Friday, with school days, days off and events (the board's, the school's, the class's). */
  weeks: SchoolWeek[];
}

/** A class's school year and its weeks. Null when the class cannot be read. */
export async function loadClassYearWeeks(cls: {
  id: string;
  schoolId: string;
  boardId: string;
}): Promise<ClassYearWeeks | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from('classes')
    .select('school_years(id, name, starts_on, ends_on)')
    .eq('id', cls.id)
    .maybeSingle();
  const y = row?.school_years;
  if (!y) return null;
  // A board admin who teaches sees every school's events: page by page past PostgREST's cap.
  const { data: events } = await fetchAllRows((from, to) =>
    supabase
      .from('school_calendar_events')
      .select(
        'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
      )
      .eq('board_id', cls.boardId)
      .lte('starts_on', y.ends_on)
      .gte('ends_on', y.starts_on)
      .order('starts_on')
      .order('id')
      .range(from, to),
  );
  const calendar: YearCalendarEvent[] = (events ?? []).map((e) => ({
    ...toCalendarEvent(e),
    schoolId: e.school_id,
  }));
  return {
    year: { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on },
    weeks: schoolWeeks({
      startsOn: y.starts_on,
      endsOn: y.ends_on,
      events: calendar,
      schoolId: cls.schoolId,
      classId: cls.id,
    }),
  };
}

/** An attente the unit planning dialog offers (« Attentes visées »). */
export interface ExpectationChoice {
  id: string;
  code: string;
  text: string;
  kind: 'overall' | 'specific';
  parentId: string | null;
  verified: boolean;
  gradeCode: string;
  gradeLabel: string;
  /** « C. Compréhension… », the domaine; null when the attente has none. */
  strand: string | null;
  strandOrder: number;
  sortOrder: number;
}

/**
 * The attentes of a subject for a class's grades, by grade, domaine and the curriculum's order.
 * Everyone signed in reads the curriculum (it is reference data).
 */
export async function loadExpectationChoices(
  subjectId: string,
  gradeCodes: readonly string[],
  locale: string,
): Promise<ExpectationChoice[]> {
  if (gradeCodes.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('curriculum_expectations')
    .select(
      'id, code, text_fr, text_en, kind, parent_id, is_verified, grade_code, sort_order, grades(label_fr, label_en, ordinal), strands(code, label_fr, label_en, sort_order)',
    )
    .eq('subject_id', subjectId)
    .in('grade_code', [...gradeCodes])
    .order('sort_order')
    .limit(2000);
  const rows = (data ?? []).map((e) => ({
    ordinal: e.grades?.ordinal ?? 0,
    choice: {
      id: e.id,
      code: e.code,
      text: localized(locale, e.text_fr, e.text_en),
      kind: e.kind,
      parentId: e.parent_id,
      verified: e.is_verified,
      gradeCode: e.grade_code,
      gradeLabel: e.grades ? localized(locale, e.grades.label_fr, e.grades.label_en) : e.grade_code,
      strand: e.strands
        ? `${e.strands.code}. ${localized(locale, e.strands.label_fr, e.strands.label_en)}`
        : null,
      strandOrder: e.strands?.sort_order ?? 999,
      sortOrder: e.sort_order,
    } satisfies ExpectationChoice,
  }));
  rows.sort(
    (a, b) =>
      a.ordinal - b.ordinal ||
      a.choice.strandOrder - b.choice.strandOrder ||
      a.choice.sortOrder - b.choice.sortOrder ||
      a.choice.code.localeCompare(b.choice.code, 'fr-CA', { numeric: true }),
  );
  return rows.map((r) => r.choice);
}

/** A unit as « Mon année » shows it: where it goes on the year, and what its dialog needs. */
export interface YearPlanUnit extends PlacementUnit {
  description: string | null;
  /** Its unit-level attentes (`unit_expectations`). */
  expectationIds: string[];
}

export interface YearPlanData extends ClassYearWeeks {
  /** The school's date today. */
  today: LocalDate;
  periods: ReportPeriod[];
  /** The class's units, archived ones aside, with the dates their lessons were taught. */
  units: YearPlanUnit[];
  /** The subjects a unit of the class may take, in the board's order. */
  subjects: SubjectOption[];
  /** The subjects of the class's timetable blocks. */
  blockSubjectIds: Set<string>;
}

/**
 * « Mon année » (DECISIONS D-126): a class's school year (weeks, days off, events), its report
 * periods, its units with their windows, attentes and taught dates, and its subjects, all under
 * row level security as the signed-in teacher. Null when the class's year cannot be read.
 */
export async function loadYearPlan(
  session: SessionContext,
  cls: ClassDetail,
  locale: string,
): Promise<YearPlanData | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const board = session.boards.find((b) => b.id === school.boardId);
  const supabase = await createSupabaseServerClient();
  const [classYear, unitsRes, progressRes, blocksRes, subjects] = await Promise.all([
    loadClassYearWeeks(cls),
    supabase
      .from('units')
      .select(
        'id, subject_id, title, description, status, planned_start_on, planned_end_on, subjects(id, label_fr, label_en, color), unit_expectations(expectation_id), unit_lessons(id)',
      )
      .eq('class_id', cls.id)
      .neq('status', 'archived')
      .order('sort_order')
      .order('created_at'),
    // When lessons were taught: given, or reported by a substitute (D-054).
    fetchAllRows((from, to) =>
      supabase
        .from('lesson_progress')
        .select('lesson_id, taught_on')
        .eq('class_id', cls.id)
        .in('status', ['completed', 'pending_confirmation'])
        .not('taught_on', 'is', null)
        .order('lesson_id')
        .range(from, to),
    ),
    supabase
      .from('timetable_blocks')
      .select('subject_id')
      .eq('class_id', cls.id)
      .eq('kind', 'subject'),
    loadSubjectsForGrades(cls.gradeOrdinals, board?.settings, locale),
  ]);
  if (!classYear) return null;
  const { data: periodRows } = await supabase
    .from('report_periods')
    .select('kind, starts_on, ends_on, due_on, issued_on')
    .eq('school_year_id', classYear.year.id);

  const taughtOn = new Map(
    (progressRes.data ?? []).flatMap((p) => (p.taught_on ? [[p.lesson_id, p.taught_on]] : [])),
  );
  const rows = unitsRes.data ?? [];
  // A unit's subject the class's grades no longer offer (a board setting changed) keeps its row.
  const known = new Set(subjects.map((s) => s.id));
  const extra: SubjectOption[] = [];
  for (const u of rows) {
    if (known.has(u.subject_id) || !u.subjects) continue;
    known.add(u.subject_id);
    extra.push({
      id: u.subject_id,
      code: '',
      label: localized(locale, u.subjects.label_fr, u.subjects.label_en),
      color: u.subjects.color,
    });
  }

  return {
    ...classYear,
    today: localDateIn(school.timezone),
    periods: (periodRows ?? []).map((p) => ({
      kind: p.kind as ReportPeriod['kind'],
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      dueOn: p.due_on,
      issuedOn: p.issued_on,
    })),
    units: rows.map((u) => ({
      id: u.id,
      subjectId: u.subject_id,
      title: u.title,
      description: u.description,
      status: u.status,
      plannedStartOn: u.planned_start_on,
      plannedEndOn: u.planned_end_on,
      taughtOn: u.unit_lessons.flatMap((l) => {
        const date = taughtOn.get(l.id);
        return date ? [date] : [];
      }),
      expectationIds: u.unit_expectations.map((e) => e.expectation_id),
    })),
    subjects: [...subjects, ...extra],
    blockSubjectIds: new Set(
      (blocksRes.data ?? []).flatMap((b) => (b.subject_id ? [b.subject_id] : [])),
    ),
  };
}
