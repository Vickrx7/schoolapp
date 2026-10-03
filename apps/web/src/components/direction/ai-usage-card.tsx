import { useLocale, useTranslations } from 'next-intl';
import type { AiUsage } from '@/components/school/ai-school-card';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui/card';

/**
 * « Utilisation de l'IA ce mois-ci » (DECISIONS D-102, D-104): the school's totals only
 * (`ai_usage_summary`), never who used it. The switch itself stays on « École ».
 */
export function AiUsageCard({ usage, aiOn }: { usage: AiUsage | null; aiOn: boolean }) {
  const t = useTranslations('direction.ai');
  const tSchool = useTranslations('school');
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-slate-900">{t('title')}</h3>
      </CardHeader>
      <CardBody className="space-y-2 text-sm">
        {!aiOn ? <p className="text-slate-600">{t('off')}</p> : null}
        {usage ? (
          <>
            <p className="text-slate-800">
              {tSchool('aiSpent', {
                spent: money.format(usage.spent),
                allowance: money.format(usage.allowance),
              })}{' '}
              · {tSchool('aiRequests', { count: usage.requests })}
            </p>
            {usage.pooling ? (
              <p className="text-slate-600">
                {tSchool('aiPool', {
                  spent: money.format(usage.poolSpent),
                  total: money.format(usage.poolTotal),
                })}
              </p>
            ) : null}
            {!usage.available && aiOn ? (
              <Notice tone="warning">{tSchool('aiLimitReached')}</Notice>
            ) : null}
          </>
        ) : (
          <p className="text-slate-600">{t('unavailable')}</p>
        )}
      </CardBody>
    </Card>
  );
}
