import type { ModuleKey } from '@lynx/db';
import { getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * What a board admin sees but does not change on a school (DECISIONS D-108): the schedule, the
 * modules IP Lynx licensed, and the alerts switch, which is the school's direction's alone.
 */
export async function SchoolReadonlyCard({
  scheduleType,
  cycleLength,
  modules,
  studentAlertsEnabled,
}: {
  scheduleType: 'weekly' | 'cycle';
  cycleLength: number | null;
  modules: ModuleKey[];
  studentAlertsEnabled: boolean;
}) {
  const t = await getTranslations('board.schools');
  const shown = modules.filter((m) => m !== 'core');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('setup')}</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium text-slate-700">{t('schedule')}</dt>
            <dd className="text-slate-900">
              {scheduleType === 'cycle' ? t('cycle', { count: cycleLength ?? 0 }) : t('weekly')}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-700">{t('modules')}</dt>
            <dd className="text-slate-900">
              {shown.length
                ? t('modulesLine', {
                    modules: shown.map((m) => t(`moduleNames.${m}`)).join(' · '),
                  })
                : t('noModules')}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-900">
          {studentAlertsEnabled ? t('alertsOn') : t('alertsOff')}
        </p>
      </CardBody>
    </Card>
  );
}
