import { Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import {
  MINE_TABS,
  loadMyLibrary,
  mineTabOf,
  type MineTab,
} from '@/server/queries/library-authoring';
import { loadLibrarySearchOptions } from '@/server/queries/library-search';
import { librarySchools, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryEdit.mine');
  return { title: t('title') };
}

const isTab = (value: unknown): value is MineTab =>
  typeof value === 'string' && (MINE_TABS as readonly string[]).includes(value);

/**
 * « Mes ressources » (DECISIONS D-063): the user's own resources by where they are in the
 * workflow — « Brouillons », « Révisées », « Partagées », « Approuvées », « À retravailler »
 * (with the reviewer's note) and « Archivées » — and « En préparation », the AI requests still
 * being prepared. For teachers and direction of a library school.
 */
export default async function MyLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!librarySchools(session).length) notFound();
  const locale = await getLocale();
  const [t, tc, format, library, options, query] = await Promise.all([
    getTranslations('libraryEdit.mine'),
    getTranslations('libraryCommon'),
    getFormatter(),
    loadMyLibrary(session),
    loadLibrarySearchOptions(session, locale),
    searchParams,
  ]);
  const gradeLabel = (code: string) => options.grades.find((g) => g.code === code)?.label ?? code;
  const wanted = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const byTab = new Map<MineTab, typeof library.items>(MINE_TABS.map((tab) => [tab, []]));
  for (const item of library.items) byTab.get(mineTabOf(item))!.push(item);
  // The first tab with something in it, unless one is asked for.
  const tab: MineTab = isTab(wanted)
    ? wanted
    : (MINE_TABS.find((x) => byTab.get(x)!.length) ?? 'drafts');
  const items = byTab.get(tab)!;
  const date = (instant: string) =>
    format.dateTime(new Date(instant), { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link
            href="/library"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            {t('back')}
          </Link>
        }
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button asChild>
            <Link href="/library/new">
              <Plus aria-hidden />
              {t('create')}
            </Link>
          </Button>
        }
      />

      {library.preparing.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('preparing')}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-slate-100">
              {library.preparing.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-2 py-2">
                  <Link
                    href={`/library/generate/${job.id}`}
                    className="inline-flex min-h-11 items-center gap-2 font-medium text-slate-900 hover:underline"
                  >
                    <Sparkles className="size-4 text-brand-700" aria-hidden />
                    {job.feature === 'library_levels' ? t('jobLevels') : t('jobItem')}
                  </Link>
                  <span className="text-sm text-slate-600">
                    {t(`jobStatus.${job.status}`)} · {date(job.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <nav aria-label={t('tabsLabel')}>
        <ul className="flex flex-wrap gap-2">
          {MINE_TABS.map((x) => (
            <li key={x}>
              <Link
                href={`/library/mine?tab=${x}`}
                aria-current={x === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
                  x === tab
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {t('tab', { label: t(`tabs.${x}`), count: byTab.get(x)!.length })}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="mine-list">
        <h2 id="mine-list" className="sr-only">
          {t(`tabs.${tab}`)}
        </h2>
        {items.length === 0 ? (
          <EmptyState title={t(`empty.${tab}`)} />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge tone="brand">{tc(`types.${item.type}`)}</Badge>
                    {item.gradeCodes.length ? (
                      <span>{item.gradeCodes.map(gradeLabel).join(', ')}</span>
                    ) : null}
                    {item.source === 'ai_generated' ? <Badge>{tc('badges.ai')}</Badge> : null}
                    {item.requested ? <Badge tone="brand">{tc('requested')}</Badge> : null}
                    {tab === 'shared' ? <Badge>{tc(`scope.${item.shareScope}`)}</Badge> : null}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900">
                    <Link
                      href={`/library/items/${item.id}`}
                      className="flex min-h-11 items-center hover:text-brand-700 hover:underline"
                    >
                      {item.title}
                    </Link>
                  </h3>
                  {tab === 'rework' && item.reviewNote ? (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm whitespace-pre-line text-amber-900">
                      {t('note', { note: item.reviewNote })}
                    </p>
                  ) : null}
                  <p className="text-xs text-slate-600">
                    {t('updated', { date: date(item.updatedAt) })}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
