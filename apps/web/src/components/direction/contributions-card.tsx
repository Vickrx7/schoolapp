import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import type { ContributionItem, Contributions } from '@/server/queries/direction';

function statusLabel(item: ContributionItem): 'approved' | 'sharedBoard' | 'sharedSchool' {
  if (item.status === 'board_approved') return 'approved';
  return item.shareScope === 'board' ? 'sharedBoard' : 'sharedSchool';
}

/**
 * « Contributions à la banque de ressources » (DECISIONS D-102): this school year's resources of
 * the school shared after their author's review, or approved by the board, as counts, then the
 * 10 latest credited as on the item page. Never a count per teacher.
 */
export function ContributionsCard({ contributions }: { contributions: Contributions }) {
  const t = useTranslations('direction.contributions');
  const tc = useTranslations('libraryCommon');
  const locale = useLocale();
  const date = formatLocalDate(contributions.since, locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-1">
        <h3 className="text-base font-semibold text-slate-900">{t('title')}</h3>
        <p className="text-sm text-slate-600">
          {contributions.schoolYear ? t('since', { date }) : t('sinceDate', { date })}
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-slate-800" data-testid="contribution-counts">
          {t('counts', {
            school: contributions.school,
            board: contributions.board,
            approved: contributions.approved,
          })}
        </p>
        {contributions.latest.length === 0 ? (
          <p className="text-sm text-slate-600">{t('empty')}</p>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-slate-800">{t('latest')}</h4>
            <ul className="divide-y divide-slate-100">
              {contributions.latest.map((item) => (
                <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`/library/items/${item.id}`}
                    className="inline-flex min-h-11 items-center font-medium text-brand-700 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                    <span>
                      {[tc(`types.${item.type}`), item.boardOwned ? t('board') : item.authorName]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <Badge tone={item.status === 'board_approved' ? 'success' : 'brand'}>
                      {t(statusLabel(item))}
                    </Badge>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
