'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { useAction } from '@/hooks/use-action';
import { setSchoolAi } from '@/server/actions/school';

export interface AiUsage {
  spent: number;
  allowance: number;
  poolSpent: number;
  poolTotal: number;
  pooling: boolean;
  available: boolean;
  requests: number;
}

/** The direction turns AI on or off for their school and sees this month's usage. */
export function AiSchoolCard({
  school,
  canEdit,
  usage,
}: {
  school: { id: string; name: string; aiEnabled: boolean; boardAllows: boolean };
  canEdit: boolean;
  usage: AiUsage | null;
}) {
  const t = useTranslations('school');
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const enable = useAction(setSchoolAi, { successMessage: t('aiEnabledSaved') });
  const disable = useAction(setSchoolAi, { successMessage: t('aiDisabledSaved') });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('aiTitle')} · {school.name}
        </CardTitle>
        <Badge tone={school.aiEnabled ? 'success' : 'neutral'}>
          {school.aiEnabled ? t('aiStatusOn') : t('aiStatusOff')}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-slate-700">{t('aiIntro')}</p>
        <p className="text-sm text-slate-600">{t('aiPrivacy')}</p>
        {usage ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">{t('aiUsage')}</p>
            <p>
              {t('aiSpent', {
                spent: money.format(usage.spent),
                allowance: money.format(usage.allowance),
              })}{' '}
              · {t('aiRequests', { count: usage.requests })}
            </p>
            {usage.pooling ? (
              <p className="text-slate-600">
                {t('aiPool', {
                  spent: money.format(usage.poolSpent),
                  total: money.format(usage.poolTotal),
                })}
              </p>
            ) : null}
            {!usage.available ? (
              <Notice tone="warning" className="mt-2">
                {t('aiLimitReached')}
              </Notice>
            ) : null}
          </div>
        ) : null}
        {!school.boardAllows ? (
          <Notice tone="warning">{t('aiBoardOff')}</Notice>
        ) : canEdit ? (
          school.aiEnabled ? (
            <Button
              variant="secondary"
              disabled={disable.pending}
              onClick={() => void disable.run(school.id, false)}
            >
              {t('aiDisable')}
            </Button>
          ) : (
            <ConfirmButton
              label={t('aiEnable')}
              message={t('aiEnableConfirm', { school: school.name })}
              confirmLabel={t('aiEnable')}
              size="md"
              tone="primary"
              onConfirm={() => enable.run(school.id, true)}
            />
          )
        ) : (
          <p className="text-sm text-slate-500">{t('aiOnlyDirection')}</p>
        )}
      </CardBody>
    </Card>
  );
}
