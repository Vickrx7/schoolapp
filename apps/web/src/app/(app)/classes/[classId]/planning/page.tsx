import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { NewUnitButton } from '@/components/planning/new-unit-button';
import { UnitStatusButton } from '@/components/planning/unit-actions';
import { Badge, Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { loadClass } from '@/server/queries/classes';
import { loadSubjectsForGrades } from '@/server/queries/subjects';
import { findSchool, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

export default async function PlanningPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await requireSession();
  const cls = (await loadClass(session, classId))!;
  const school = findSchool(session, cls.schoolId)!;
  const board = session.boards.find((b) => b.id === school.boardId);
  const t = await getTranslations('units');
  const supabase = await createSupabaseServerClient();

  const [unitsRes, progressRes, subjects] = await Promise.all([
    supabase
      .from('units')
      .select('id, subject_id, title, description, status, sort_order, unit_lessons(id)')
      .eq('class_id', classId)
      .neq('status', 'archived')
      .order('sort_order')
      .order('created_at'),
    supabase.from('lesson_progress').select('lesson_id, status').eq('class_id', classId),
    loadSubjectsForGrades(cls.gradeOrdinals, board?.settings),
  ]);

  const done = new Set(
    (progressRes.data ?? [])
      .filter((p) => p.status === 'completed' || p.status === 'skipped')
      .map((p) => p.lesson_id),
  );
  const units = unitsRes.data ?? [];
  const bySubject = subjects
    .map((s) => ({ subject: s, units: units.filter((u) => u.subject_id === s.id) }))
    .filter((g) => g.units.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-slate-600">{t('intro')}</p>
        <NewUnitButton classId={classId} subjects={subjects} />
      </div>

      {bySubject.length === 0 ? (
        <EmptyState
          title={t('empty')}
          action={<NewUnitButton classId={classId} subjects={subjects} />}
        />
      ) : (
        bySubject.map(({ subject, units: list }) => (
          <section key={subject.id}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: subject.color ?? '#94a3b8' }}
                aria-hidden
              />
              {subject.label}
            </h2>
            <ul className="space-y-2">
              {list.map((u) => {
                const total = u.unit_lessons.length;
                const doneCount = u.unit_lessons.filter((l) => done.has(l.id)).length;
                return (
                  <li key={u.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <Link
                          href={`/classes/${classId}/planning/${u.id}`}
                          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {u.title}
                        </Link>
                        <p className="mt-0.5 text-sm text-slate-600">
                          {t('lessonCount', { done: doneCount, total })}
                        </p>
                        {total > 0 ? (
                          <div
                            className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-slate-100"
                            aria-hidden
                          >
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${(doneCount / total) * 100}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={u.status === 'active' ? 'success' : 'neutral'}>
                          {t(`status.${u.status}`)}
                        </Badge>
                        {u.status !== 'active' ? (
                          <UnitStatusButton classId={classId} unitId={u.id} status="active" />
                        ) : null}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
