import { localDateIn, nextLessons, type ProgressStatus } from '@lynx/domain';
import { ChevronLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { localized } from '@/i18n/config';
import Link from 'next/link';
import { LessonList } from '@/components/planning/lesson-list';
import { EditUnitButton, UnitStatusButton } from '@/components/planning/unit-actions';
import { Badge } from '@/components/ui/card';
import { loadClass } from '@/server/queries/classes';
import { findSchool, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

/**
 * The report a pending lesson is confirmed in (D-054): a lesson the substitute reported is
 * confirmed there, never checked off from here.
 */
function pendingReportOf(
  row:
    | {
        status: ProgressStatus;
        sub_reports: { sub_plan_id: string; sub_plans: { absence_id: string } | null } | null;
      }
    | undefined,
): { absenceId: string; planId: string } | null {
  if (row?.status !== 'pending_confirmation' || !row.sub_reports?.sub_plans) return null;
  return { absenceId: row.sub_reports.sub_plans.absence_id, planId: row.sub_reports.sub_plan_id };
}

export default async function UnitPage({
  params,
}: {
  params: Promise<{ classId: string; unitId: string }>;
}) {
  const { classId, unitId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time
  // (e.g. right after the class was deleted), so check here too.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const school = findSchool(session, cls.schoolId)!;
  const t = await getTranslations();
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();

  const { data: unit } = await supabase
    .from('units')
    .select(
      'id, title, description, status, subject_id, subjects(label_fr, label_en, color), unit_lessons(id, sequence_number, title, objectives, materials, content, sub_notes, duration_minutes, unit_lesson_expectations(expectation_id))',
    )
    .eq('id', unitId)
    .eq('class_id', classId)
    .maybeSingle();
  if (!unit) notFound();

  const lessonIds = unit.unit_lessons.map((l) => l.id);
  const [progressRes, expectationsRes] = await Promise.all([
    lessonIds.length
      ? supabase
          .from('lesson_progress')
          // The substitute's report behind a pending lesson (sub_reports is the owner's, RLS).
          .select('lesson_id, status, taught_on, sub_reports(sub_plan_id, sub_plans(absence_id))')
          .in('lesson_id', lessonIds)
      : Promise.resolve({
          data: [] as {
            lesson_id: string;
            status: ProgressStatus;
            taught_on: string | null;
            sub_reports: { sub_plan_id: string; sub_plans: { absence_id: string } | null } | null;
          }[],
        }),
    supabase
      .from('curriculum_expectations')
      .select(
        'id, code, text_fr, kind, is_verified, sort_order, strands(code, label_fr, sort_order)',
      )
      .eq('subject_id', unit.subject_id)
      .in('grade_code', cls.gradeCodes)
      .order('sort_order'),
  ]);

  const progress = new Map((progressRes.data ?? []).map((p) => [p.lesson_id, p]));
  const lessons = [...unit.unit_lessons]
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((l) => ({
      id: l.id,
      sequenceNumber: l.sequence_number,
      title: l.title,
      objectives: l.objectives,
      materials: l.materials,
      content: l.content,
      subNotes: l.sub_notes,
      durationMinutes: l.duration_minutes,
      expectationIds: l.unit_lesson_expectations.map((e) => e.expectation_id),
      status: progress.get(l.id)?.status ?? null,
      taughtOn: progress.get(l.id)?.taught_on ?? null,
      pendingReport: pendingReportOf(progress.get(l.id)),
    }));
  const next = nextLessons(
    lessons,
    new Map(lessons.filter((l) => l.status).map((l) => [l.id, l.status as ProgressStatus])),
  ).next[0];

  return (
    <div className="space-y-4">
      <Link
        href={`/classes/${classId}/planning`}
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('units.title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: unit.subjects?.color ?? '#94a3b8' }}
              aria-hidden
            />
            {unit.subjects
              ? localized(locale, unit.subjects.label_fr, unit.subjects.label_en)
              : null}
          </p>
          <h2 className="text-xl font-bold">{unit.title}</h2>
          {unit.description ? (
            <p className="mt-1 max-w-prose text-slate-600">{unit.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={unit.status === 'active' ? 'success' : 'neutral'}>
            {t(`units.status.${unit.status}`)}
          </Badge>
          {unit.status !== 'active' ? (
            <UnitStatusButton classId={classId} unitId={unitId} status="active" />
          ) : null}
          {unit.status === 'active' ? (
            <UnitStatusButton classId={classId} unitId={unitId} status="completed" />
          ) : null}
          <EditUnitButton
            classId={classId}
            unitId={unitId}
            title={unit.title}
            description={unit.description}
          />
        </div>
      </div>
      <LessonList
        userId={session.userId}
        classId={classId}
        unitId={unitId}
        lessons={lessons}
        nextLessonId={next?.id ?? null}
        today={localDateIn(school.timezone)}
        expectations={(expectationsRes.data ?? []).map((e) => ({
          id: e.id,
          code: e.code,
          text: e.text_fr,
          kind: e.kind,
          verified: e.is_verified,
          strand: e.strands ? `${e.strands.code}. ${e.strands.label_fr}` : null,
        }))}
      />
    </div>
  );
}
