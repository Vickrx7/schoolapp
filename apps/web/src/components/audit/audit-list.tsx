import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { AuditEntryView } from '@/server/audit/labels';
import { AuditFlags, AuditWho } from './audit-entry';

export interface AuditListEntry extends AuditEntryView {
  /** « Historique de cet élément »: the same filters for this item only. */
  historyHref: string | null;
}

function HistoryLink({ href, person }: { href: string; person: boolean }) {
  const t = useTranslations('audit');
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-brand-700 hover:underline"
    >
      <History className="size-4" aria-hidden />
      {person ? t('historyPerson') : t('history')}
    </Link>
  );
}

/**
 * « Journal d'audit » entries, newest first (DECISIONS D-103): cards with a description list on
 * phones; from `md:`, a table. `showSchool` adds the school (a board's view of several schools).
 */
export function AuditList({
  entries,
  showSchool,
}: {
  entries: AuditListEntry[];
  showSchool: boolean;
}) {
  const t = useTranslations('audit');
  return (
    <>
      <ul className="space-y-2 md:hidden" aria-label={t('caption')}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card className="space-y-2 p-4" data-testid="audit-entry">
              <p className="font-medium text-slate-900">{entry.sentence}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-600">{t('columns.when')}</dt>
                <dd className="min-w-0 tabular-nums">{entry.when}</dd>
                <dt className="text-slate-600">{t('columns.who')}</dt>
                <dd className="min-w-0 break-words">
                  <AuditWho entry={entry} />
                </dd>
                {entry.entity ? (
                  <>
                    <dt className="text-slate-600">{t('columns.item')}</dt>
                    <dd className="min-w-0 break-words">{entry.entity}</dd>
                  </>
                ) : null}
                {showSchool && entry.schoolName ? (
                  <>
                    <dt className="text-slate-600">{t('columns.school')}</dt>
                    <dd className="min-w-0 break-words">{entry.schoolName}</dd>
                  </>
                ) : null}
              </dl>
              {entry.flags.length ? (
                <p className="flex flex-wrap gap-1.5">
                  <AuditFlags entry={entry} />
                </p>
              ) : null}
              {entry.historyHref ? (
                <HistoryLink href={entry.historyHref} person={entry.entityType === 'user'} />
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('columns.when')}
              </th>
              <th scope="col" className="min-w-40 px-4 py-2 font-medium">
                {t('columns.who')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('columns.action')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('columns.item')}
              </th>
              {showSchool ? (
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('columns.school')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {entries.map((entry) => (
              <tr key={entry.id} data-testid="audit-row">
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{entry.when}</td>
                <td className="px-4 py-3">
                  <AuditWho entry={entry} />
                  {entry.flags.length ? (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <AuditFlags entry={entry} />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-900">{entry.sentence}</td>
                <td className="px-4 py-3">
                  {entry.entity ? <span className="block">{entry.entity}</span> : null}
                  {entry.historyHref ? (
                    <HistoryLink href={entry.historyHref} person={entry.entityType === 'user'} />
                  ) : null}
                </td>
                {showSchool ? <td className="px-4 py-3">{entry.schoolName ?? '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
