import { RETENTION_KEYS, type BoardSettings } from '@lynx/domain';
import { getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * « Conservation des données » (DECISIONS D-105), read only: how long the board's data is kept
 * before the nightly clean-up deletes it. IP Lynx sets it (`pnpm admin set-retention`).
 */
export async function RetentionCard({ retention }: { retention: BoardSettings['retention'] }) {
  const t = await getTranslations('board.retention');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-slate-600">{t('intro')}</p>
        <dl className="divide-y divide-slate-100 text-sm">
          {RETENTION_KEYS.map((key) => (
            <div key={key} className="flex flex-wrap justify-between gap-x-3 py-2">
              <dt className="text-slate-700">{t(key)}</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {t('days', { count: retention[key] })}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-slate-600">{t('planningKept')}</p>
      </CardBody>
    </Card>
  );
}
