import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { longDate, shortDate } from '@/components/year-plan/year-format';
import { weeksToPrepare } from '@/server/newsletter/view-model';
import { loadClass } from '@/server/queries/classes';
import { loadNewsletterList } from '@/server/queries/newsletters';
import { findSchool, hasRole, requireSession } from '@/server/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const session = await requireSession();
  const [cls, t] = await Promise.all([loadClass(session, classId), getTranslations('newsletter')]);
  return { title: cls ? t('metaTitle', { className: cls.name }) : t('title') };
}

/**
 * « Info-parents » (`/classes/[id]/info-parents`, DECISIONS D-136): the class's weekly
 * messages to families, newest week first, and « Préparer la semaine du … » for this week and the
 * next when they have none. For the class team with a teacher role (row level security); the app
 * sends nothing to families.
 */
export default async function InfoParentsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const school = findSchool(session, cls.schoolId);
  if (!school || !cls.myRole || !hasRole(school, 'teacher')) notFound();
  const [t, locale, data] = await Promise.all([
    getTranslations('newsletter'),
    getLocale(),
    loadNewsletterList(session, cls),
  ]);

  const heading = (
    <div className="min-w-0 space-y-1">
      <h2 className="text-xl font-bold text-slate-900">{t('title')}</h2>
      <p className="max-w-prose text-slate-600">{t('intro')}</p>
    </div>
  );
  if (!data) {
    return (
      <div className="space-y-5">
        {heading}
        <Notice tone="warning">{t('editor.unreadable')}</Notice>
      </div>
    );
  }
  const weeks = data.year
    ? weeksToPrepare(
        data.today,
        data.year,
        data.rows.map((r) => r.weekOf),
      )
    : [];

  return (
    <div className="space-y-5">
      {heading}
      {weeks.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="prepare-weeks">
          {weeks.map((week, i) => (
            <Button key={week} asChild variant={i === 0 ? 'primary' : 'secondary'}>
              <Link href={`/classes/${classId}/info-parents/${week}`}>
                {t('prepareWeek', { date: longDate(week, locale) })}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="newsletters-heading" className="space-y-2">
        <h3 id="newsletters-heading" className="font-semibold text-slate-900">
          {t('listHeading')}
        </h3>
        {data.rows.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {data.rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/classes/${classId}/info-parents/${row.weekOf}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="font-medium text-brand-700">
                    {t('weekOf', { date: longDate(row.weekOf, locale) })}
                  </span>
                  <span
                    className={
                      row.status === 'sent' ? 'text-sm text-emerald-800' : 'text-sm text-slate-600'
                    }
                  >
                    {row.status === 'sent'
                      ? t('status.sent', { date: shortDate(row.sentOn ?? row.updatedOn, locale) })
                      : row.updatedBy
                        ? t('status.draft', {
                            date: shortDate(row.updatedOn, locale),
                            name: row.updatedBy,
                          })
                        : t('status.draftNoName', { date: shortDate(row.updatedOn, locale) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Help />
    </div>
  );
}

/** « Comment ça marche ». */
async function Help() {
  const t = await getTranslations('newsletter.help');
  const items = ['sources', 'review', 'channel', 'team', 'erase'] as const;
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-slate-900">
        {t('summary')}
      </summary>
      <ul className="list-disc space-y-1.5 px-4 pb-4 pl-9 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item}>{t(item)}</li>
        ))}
      </ul>
    </details>
  );
}
