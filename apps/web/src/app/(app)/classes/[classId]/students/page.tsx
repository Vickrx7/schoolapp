import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { localized } from '@/i18n/config';
import { StudentsManager } from '@/components/students/students-manager';
import { Notice } from '@/components/ui/card';
import { loadClass } from '@/server/queries/classes';
import { findSchool, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';
import { serverEnv } from '@/server/env';

const collator = new Intl.Collator('fr-CA', { sensitivity: 'base' });

export default async function StudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time
  // (e.g. right after the class was deleted), so check here too.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const school = findSchool(session, cls.schoolId)!;
  const t = await getTranslations('students');
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();

  const [students, levels] = await Promise.all([
    supabase
      .from('students')
      .select('id, first_name, default_language_level_id, active')
      .eq('class_id', classId)
      .order('active', { ascending: false })
      .order('first_name'),
    supabase
      .from('language_levels')
      .select('id, label_fr, label_en, owner_user_id, sort_order')
      .eq('board_id', school.boardId)
      .eq('active', true)
      .order('sort_order'),
  ]);

  return (
    <div className="space-y-4">
      <Notice>{t('privacy')}</Notice>
      <StudentsManager
        classId={classId}
        students={(students.data ?? [])
          .map((s) => ({
            id: s.id,
            firstName: s.first_name,
            levelId: s.default_language_level_id,
            active: s.active,
          }))
          // French alphabetical order (é sorts with e), active students first.
          .sort(
            (a, b) =>
              Number(b.active) - Number(a.active) || collator.compare(a.firstName, b.firstName),
          )}
        levels={(levels.data ?? []).map((l) => ({
          id: l.id,
          label: localized(locale, l.label_fr, l.label_en),
        }))}
        alertsAvailable={school.studentAlertsEnabled && serverEnv().ALERTS_ENCRYPTION_KEYS !== ''}
      />
    </div>
  );
}
