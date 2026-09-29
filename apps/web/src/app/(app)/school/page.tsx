import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AiSchoolCard, type AiUsage } from '@/components/school/ai-school-card';
import { SchoolSettingsForm } from '@/components/school/school-settings-form';
import { SubstituteSettingsCard } from '@/components/school/substitute-settings-card';
import { PageHeader } from '@/components/ui/page';
import { hasModule, hasRole, requireSession } from '@/server/session';
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
  // Usage is for the direction only (the function refuses office staff).
  const usage = new Map<string, AiUsage>();
  await Promise.all(
    schools
      .filter((s) => hasRole(s, 'principal', 'vice_principal'))
      .map(async (s) => {
        const { data } = await supabase.rpc('ai_usage_summary', { p_school_id: s.id });
        const row = data?.[0];
        if (row) {
          usage.set(s.id, {
            spent: Number(row.school_spent_usd),
            allowance: Number(row.allowance_usd),
            poolSpent: Number(row.pool_spent_usd),
            poolTotal: Number(row.pool_usd),
            pooling: row.pooling,
            available: row.available,
            requests: Number(row.requests_this_month),
          });
        }
      }),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} />
      {schools.map((s) => (
        <div key={s.id} className="space-y-4">
          <SchoolSettingsForm
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
          <AiSchoolCard
            school={{
              id: s.id,
              name: s.name,
              aiEnabled: s.aiEnabled,
              boardAllows:
                session.boards.find((b) => b.id === s.boardId)?.settings.ai.allowed ?? true,
            }}
            canEdit={hasRole(s, 'principal', 'vice_principal')}
            usage={usage.get(s.id) ?? null}
          />
          {hasModule(s, 'teaching') ? (
            <SubstituteSettingsCard
              school={{ id: s.id, name: s.name, substitute: s.settings.substitute }}
              canEdit={hasRole(s, 'principal', 'vice_principal')}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
