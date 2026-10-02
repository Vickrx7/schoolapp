/**
 * « Mon année » state for the browser tests (DECISIONS D-123, D-124): the demo year's report
 * periods and the units' planning, set up and put back as supabase/seeds/50_year_plan_demo.sql
 * left them. As the database owner (no row level security here).
 */
import { query } from './db';

/** The demo board's 2026-2027 school year (supabase/seed.sql). */
export const DEMO_YEAR = 'a0000000-0000-4000-8000-000000000001';

/** Seeded units (supabase/seed.sql). */
export const UNITS = {
  fra3: '30000000-0000-4000-8000-000000000301',
  mat3: '30000000-0000-4000-8000-000000000302',
  mat5: '30000000-0000-4000-8000-000000000501',
  sci5: '30000000-0000-4000-8000-000000000502',
};

export interface PeriodRow {
  kind: 'progress' | 'term1' | 'term2';
  starts_on: string;
  ends_on: string;
  due_on: string | null;
  issued_on: string | null;
}

/** The seeded periods: the usual dates `typicalReportPeriods` proposes. */
export const SEEDED_PERIODS: PeriodRow[] = [
  {
    kind: 'progress',
    starts_on: '2026-09-02',
    ends_on: '2026-10-30',
    due_on: '2026-11-06',
    issued_on: '2026-11-13',
  },
  {
    kind: 'term1',
    starts_on: '2026-09-02',
    ends_on: '2027-01-29',
    due_on: '2027-02-05',
    issued_on: '2027-02-12',
  },
  {
    kind: 'term2',
    starts_on: '2027-02-01',
    ends_on: '2027-06-11',
    due_on: '2027-06-16',
    issued_on: '2027-06-25',
  },
];

/** Makes the year's report periods exactly these. */
export async function setReportPeriods(periods: PeriodRow[], yearId = DEMO_YEAR): Promise<void> {
  await query('delete from public.report_periods where school_year_id = $1', [yearId]);
  for (const p of periods) {
    await query(
      `insert into public.report_periods (school_year_id, kind, starts_on, ends_on, due_on, issued_on)
       values ($1, $2, $3, $4, $5, $6)`,
      [yearId, p.kind, p.starts_on, p.ends_on, p.due_on, p.issued_on],
    );
  }
}

/** Puts the seed's periods back. */
export async function restoreReportPeriods(): Promise<void> {
  await setReportPeriods(SEEDED_PERIODS);
}

/** The year's report periods, in the order of the kinds. */
export async function reportPeriods(yearId = DEMO_YEAR): Promise<PeriodRow[]> {
  return query<PeriodRow & Record<string, unknown>>(
    `select kind, starts_on::text, ends_on::text, due_on::text, issued_on::text
     from public.report_periods where school_year_id = $1
     order by array_position(array['progress', 'term1', 'term2'], kind)`,
    [yearId],
  );
}

export interface UnitPlanRow {
  title: string;
  description: string | null;
  planned_start_on: string | null;
  planned_end_on: string | null;
  codes: string[];
}

/** A unit's planning: title, description, window and the codes of its attentes. */
export async function unitPlan(unitId: string): Promise<UnitPlanRow> {
  const [row] = await query<UnitPlanRow & Record<string, unknown>>(
    `select u.title, u.description, u.planned_start_on::text, u.planned_end_on::text,
       coalesce(array(select e.code from public.unit_expectations ue
         join public.curriculum_expectations e on e.id = ue.expectation_id
         where ue.unit_id = u.id order by e.code), '{}') as codes
     from public.units u where u.id = $1`,
    [unitId],
  );
  if (!row) throw new Error(`no unit ${unitId}`);
  return row;
}

/** Puts a unit's planning back as `unitPlan` read it (its attentes found by code). */
export async function restoreUnitPlan(unitId: string, plan: UnitPlanRow): Promise<void> {
  await query(
    `update public.units set title = $2, description = $3, planned_start_on = $4,
       planned_end_on = $5 where id = $1`,
    [unitId, plan.title, plan.description, plan.planned_start_on, plan.planned_end_on],
  );
  await query('delete from public.unit_expectations where unit_id = $1', [unitId]);
  await query(
    `insert into public.unit_expectations (unit_id, expectation_id)
     select u.id, e.id from public.units u
     join public.classes c on c.id = u.class_id
     join public.class_grades cg on cg.class_id = c.id
     join public.curriculum_expectations e
       on e.subject_id = u.subject_id and e.grade_code = cg.grade_code
     where u.id = $1 and e.code = any ($2::text[])`,
    [unitId, plan.codes],
  );
}

/** Deletes the units whose title starts with a prefix (an `e2ePrefix()`), with their lessons. */
export async function deleteUnitsTitled(prefix: string): Promise<void> {
  await query(`delete from public.units where starts_with(title, $1)`, [prefix]);
}

/**
 * A unit of a class planned for a window (« À venir »), with lessons, as the year view and
 * « Aujourd'hui » read it. Returns its id. Title it with an `e2ePrefix()` and delete it with
 * `deleteUnitsTitled`.
 */
export async function insertPlannedUnit(unit: {
  classId: string;
  subjectCode: string;
  title: string;
  startsOn: string;
  endsOn: string;
  lessons?: string[];
}): Promise<string> {
  const [row] = await query<{ id: string }>(
    `insert into public.units (class_id, subject_id, title, status, sort_order, planned_start_on, planned_end_on)
     values ($1, (select id from public.subjects where code = $2 and board_id is null), $3, 'planned', 9, $4, $5)
     returning id`,
    [unit.classId, unit.subjectCode, unit.title, unit.startsOn, unit.endsOn],
  );
  for (const [i, title] of (unit.lessons ?? []).entries()) {
    await query(
      'insert into public.unit_lessons (unit_id, sequence_number, title) values ($1, $2, $3)',
      [row!.id, i + 1, title],
    );
  }
  return row!.id;
}

/** A unit's status. */
export async function unitStatus(unitId: string): Promise<string | undefined> {
  const [row] = await query<{ status: string }>(
    'select status::text from public.units where id = $1',
    [unitId],
  );
  return row?.status;
}
