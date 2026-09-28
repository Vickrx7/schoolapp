import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { SchoolSettingsForm } from '@/components/school/school-settings-form';
import { PageHeader } from '@/components/ui/page';
import { hasRole, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('school');
  return { title: t('title') };
}

export default async function SchoolPage() {
  const session = await requireSession();
  const schools = session.schools.filter((s) =>
    hasRole(s, 'principal', 'vice_principal', 'office_admin'),
  );
  if (schools.length === 0) redirect('/today');
  const t = await getTranslations('school');
  const supabase = await createSupabaseServerClient();
  const { data: anchors } = await supabase
    .from('school_cycle_anchors')
    .select('id, school_id, anchor_date, cycle_day')
    .in(
      'school_id',
      schools.map((s) => s.id),
    )
    .order('anchor_date', { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} />
      {schools.map((s) => (
        <SchoolSettingsForm
          key={s.id}
          school={{
            id: s.id,
            name: s.name,
            scheduleType: s.scheduleType,
            cycleLength: s.cycleLength,
            studentAlertsEnabled: s.studentAlertsEnabled,
            // Only direction may toggle alerts (office staff can manage the rotation).
            canEditSettings: hasRole(s, 'principal', 'vice_principal'),
          }}
          anchors={(anchors ?? [])
            .filter((a) => a.school_id === s.id)
            .map((a) => ({ id: a.id, date: a.anchor_date, day: a.cycle_day }))}
        />
      ))}
    </div>
  );
}
