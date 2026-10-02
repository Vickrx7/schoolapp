import 'server-only';
import type { CoverageCounts } from '@lynx/domain';
import { localized } from '@/i18n/config';
import { reportError } from '../errors';
import type { YearPlanPdfExpectation, YearPlanPdfInput } from '../pdf/year-plan-model';
import { findSchool, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadCoverageInputs, overviewOf } from './class-coverage';
import type { ClassDetail } from './classes';
import { loadYearPlan } from './year-plan';

/**
 * What « Plan à long terme » prints (DECISIONS D-127), read under row level security as the
 * signed-in teacher: « Mon année » (the year's weeks, report periods and units), the attentes
 * each unit aims at, the class team's names and, only when asked, the whole year's coverage per
 * subject (D-125). Never the class's students, their alerts or anything about them.
 */
export async function loadYearPlanPdf(
  session: SessionContext,
  cls: ClassDetail,
  locale: string,
  { coverage }: { coverage: boolean },
): Promise<YearPlanPdfInput | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const supabase = await createSupabaseServerClient();
  const [plan, links, inputs] = await Promise.all([
    loadYearPlan(session, cls, locale),
    supabase
      .from('unit_expectations')
      .select(
        'unit_id, units!inner(class_id), curriculum_expectations(code, text_fr, text_en, is_verified, sort_order, grades(ordinal))',
      )
      .eq('units.class_id', cls.id),
    coverage ? loadCoverageInputs(session, cls, locale) : Promise.resolve(null),
  ]);
  if (links.error) {
    reportError('loadYearPlanPdf', links.error);
    return null;
  }
  if (!plan || (coverage && !inputs)) return null;

  // Each unit's attentes, by grade, then in the curriculum's order.
  const byUnit = new Map<string, (YearPlanPdfExpectation & { order: [number, number] })[]>();
  for (const link of links.data ?? []) {
    const e = link.curriculum_expectations;
    if (!e) continue;
    byUnit.set(link.unit_id, [
      ...(byUnit.get(link.unit_id) ?? []),
      {
        code: e.code,
        text: localized(locale, e.text_fr, e.text_en),
        verified: e.is_verified,
        order: [e.grades?.ordinal ?? 0, e.sort_order],
      },
    ]);
  }
  const ordered = (unitId: string): YearPlanPdfExpectation[] =>
    (byUnit.get(unitId) ?? [])
      .sort(
        (a, b) =>
          a.order[0] - b.order[0] ||
          a.order[1] - b.order[1] ||
          a.code.localeCompare(b.code, 'fr-CA', { numeric: true }),
      )
      .map(({ code, text, verified }) => ({ code, text, verified }));

  let coverageRows: YearPlanPdfInput['coverage'] = null;
  if (inputs) {
    const overview = overviewOf(inputs);
    const several = inputs.grades.length > 1;
    const gradeLabel = new Map(inputs.grades.map((g) => [g.code, g.label]));
    const rows: { label: string; counts: CoverageCounts }[] = overview.subjects.flatMap((s) =>
      several
        ? s.grades.map((g) => ({
            label: `${s.subject.label} · ${gradeLabel.get(g.gradeCode) ?? g.gradeCode}`,
            counts: g.counts,
          }))
        : [{ label: s.subject.label, counts: s.counts }],
    );
    const counted = new Set(overview.subjects.map((s) => s.subject.id));
    coverageRows = {
      rows,
      unverified: inputs.rows.some((r) => counted.has(r.subjectId) && !r.verified),
    };
  }

  return {
    className: cls.name,
    schoolName: school.name,
    team: cls.team.map((m) => ({ name: m.name, role: m.role })),
    year: plan.year,
    today: plan.today,
    weeks: plan.weeks,
    periods: plan.periods,
    units: plan.units.map((u) => ({
      id: u.id,
      subjectId: u.subjectId,
      title: u.title,
      status: u.status,
      plannedStartOn: u.plannedStartOn,
      plannedEndOn: u.plannedEndOn,
      taughtOn: u.taughtOn,
      expectations: ordered(u.id),
    })),
    subjects: plan.subjects.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    blockSubjectIds: plan.blockSubjectIds,
    coverage: coverageRows,
  };
}
