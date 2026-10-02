import { ScrollText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { AuditEntrySummary } from '@/components/audit/audit-entry';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import type { AuditEntryView } from '@/server/audit/labels';

/**
 * « Accès aux alertes (7 derniers jours) » (DECISIONS D-102, D-103): the latest five alert
 * entries of the school's audit log, then the whole log for alerts.
 */
export function AlertAccessCard({
  entries,
  auditHref,
}: {
  entries: AuditEntryView[];
  auditHref: string;
}) {
  const t = useTranslations('direction.alerts');
  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-slate-900">{t('title')}</h3>
      </CardHeader>
      <CardBody className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-600">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="py-2 first:pt-0 last:pb-0">
                <AuditEntrySummary entry={entry} />
              </li>
            ))}
          </ul>
        )}
        <Button asChild variant="secondary">
          <Link href={auditHref}>
            <ScrollText aria-hidden />
            {t('all')}
          </Link>
        </Button>
      </CardBody>
    </Card>
  );
}
