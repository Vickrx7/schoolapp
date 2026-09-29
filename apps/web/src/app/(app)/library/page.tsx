import { Layers, ListTree } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActiveFilters } from '@/components/library/active-filters';
import { BucketTiles } from '@/components/library/bucket-tiles';
import { FacetPanel, FacetSheet, type FacetOptions } from '@/components/library/facet-panel';
import { GradeChips } from '@/components/library/grade-chips';
import { ResultCount, ResultList } from '@/components/library/result-list';
import { SearchForm } from '@/components/library/search-form';
import { PendingRegion, SearchNavigation } from '@/components/library/search-navigation';
import { HubAiSlot } from '@/components/library/slots/hub-ai-slot';
import { HubCreateSlot } from '@/components/library/slots/hub-create-slot';
import { ResultsBannerSlot } from '@/components/library/slots/results-banner-slot';
import { Notice } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import {
  libraryHref,
  parseLibrarySearch,
  showsResults,
  type LibrarySearch,
} from '@/server/library/search-params';
import type { AttachTarget } from '@/server/library/view-model';
import {
  loadAttachTarget,
  loadLibraryHub,
  loadLibrarySearchOptions,
  loadSearchFilterLabels,
  searchLibrary,
  type LibrarySearchOptions,
} from '@/server/queries/library-search';
import {
  aiSchools,
  librarySchools,
  requireSession,
  showLibrary,
  type SessionContext,
} from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('library');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * « Banque de ressources » (`/library`, DECISIONS D-068, D-069, D-078), where « Ressources » in
 * the navigation leads: for users of a library school and for designated reviewers; office staff
 * get not found. With nothing asked it is the hub (the user's grades, « Parcourir par attente »,
 * the six categories, the creation slots and « Texte différencié »); as soon as words are typed,
 * a filter is set or a resource is being chosen for a lesson (`attachTo`), it shows the results
 * with their filters. The search lives in the address, so results can be shared, reloaded and
 * reached with « Précédent ». The search field keeps its place in both, so typing on the hub
 * turns it into results without losing the field's focus.
 */
export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const [t, locale] = await Promise.all([getTranslations('library'), getLocale()]);
  const search = parseLibrarySearch(await searchParams);
  const results = showsResults(search);
  const attachTarget = search.attachTo ? await loadAttachTarget(search.attachTo) : null;

  return (
    <SearchNavigation>
      <div className="space-y-5">
        <PageHeader title={t('title')} subtitle={results ? undefined : t('intro')} />
        <ResultsBannerSlot attachTo={attachTarget} />
        {search.attachTo && !attachTarget ? (
          <Notice tone="warning">{t('attachMissing')}</Notice>
        ) : null}
        <SearchForm search={search} />
        {results ? (
          <Results search={search} session={session} locale={locale} attachTo={attachTarget} />
        ) : (
          <Hub session={session} locale={locale} />
        )}
      </div>
    </SearchNavigation>
  );
}

/** The hub: nothing asked yet. */
async function Hub({ session, locale }: { session: SessionContext; locale: string }) {
  const t = await getTranslations('library');
  const hub = await loadLibraryHub(session, locale);
  const myGrades = hub.options.grades.filter((g) => hub.options.myGrades.includes(g.code));
  const differentiate = aiSchools(session).length > 0;

  return (
    <div className="space-y-6">
      <section aria-labelledby="library-browse" className="space-y-3">
        <h2 id="library-browse" className="sr-only">
          {t('browseHeading')}
        </h2>
        {myGrades.length ? (
          <GradeChips
            label={t('myGrades')}
            labelId="library-my-grades"
            chips={myGrades.map((g) => ({
              code: g.code,
              label: g.label,
              href: libraryHref({ grade: g.code }),
            }))}
          />
        ) : null}
        <Link
          href={
            myGrades[0] ? `/library/curriculum?grade=${myGrades[0].code}` : '/library/curriculum'
          }
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-700 hover:underline"
        >
          <ListTree className="size-5" aria-hidden />
          {t('browseCurriculum')}
        </Link>
      </section>

      <section aria-labelledby="library-categories" className="space-y-3">
        <h2 id="library-categories" className="text-base font-semibold text-slate-900">
          {t('categories')}
        </h2>
        {hub.total === 0 ? <p className="text-sm text-slate-600">{t('empty.hub')}</p> : null}
        <BucketTiles counts={hub.bucketCounts} />
      </section>

      {librarySchools(session).length ? <HubCreateSlot session={session} /> : null}
      <HubAiSlot session={session} />

      {differentiate ? (
        <section aria-labelledby="library-tools" className="space-y-3">
          <h2 id="library-tools" className="text-base font-semibold text-slate-900">
            {t('tools')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            <li>
              <Link
                href="/differentiate"
                className="flex min-h-11 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50"
              >
                <Layers className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                <span>
                  <span className="block font-medium text-slate-900">{t('differentiate')}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">
                    {t('differentiateHint')}
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The options the filter panel needs, from the search options. */
function facetOptions(options: LibrarySearchOptions): FacetOptions {
  return {
    grades: options.grades,
    subjects: options.subjects,
    anglaisStartGrade: options.anglaisStartGrade,
    levels: options.levels.map((l) => ({
      id: l.id,
      label: l.label,
      personal: l.personal,
      active: l.active,
    })),
  };
}

/** The results of a search, with the filter panel beside them (a sheet on phones). */
async function Results({
  search,
  session,
  locale,
  attachTo,
}: {
  search: LibrarySearch;
  session: SessionContext;
  locale: string;
  attachTo: AttachTarget | null;
}) {
  const t = await getTranslations('library');
  const [options, result, labels] = await Promise.all([
    loadLibrarySearchOptions(session, locale),
    searchLibrary(search),
    loadSearchFilterLabels(search, locale),
  ]);
  const gradeLabels = new Map(options.grades.map((g) => [g.code, g.label]));
  const activeLabels = {
    grade: search.grade ? (gradeLabels.get(search.grade) ?? null) : null,
    subject: options.subjects.find((s) => s.id === search.subject)?.label ?? null,
    strand: labels.strand,
    expectation: labels.expectation,
  };

  if (!result) {
    return (
      <div className="space-y-4">
        <ActiveFilters search={search} labels={activeLabels} />
        <EmptyState title={t('results.error')} />
      </div>
    );
  }

  const panelOptions = facetOptions(options);
  return (
    <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-6">
      <aside aria-labelledby="library-filters" className="hidden space-y-3 md:block">
        <h2 id="library-filters" className="text-base font-semibold text-slate-900">
          {t('filters.title')}
        </h2>
        <FacetPanel search={search} facets={result.facets} options={panelOptions} />
      </aside>
      <section aria-labelledby="library-results" className="min-w-0 space-y-4">
        <h2 id="library-results" className="sr-only">
          {t('results.heading')}
        </h2>
        <div className="flex items-start justify-between gap-3">
          <ResultCount total={result.total} />
          <div className="shrink-0 md:hidden">
            <FacetSheet
              search={search}
              facets={result.facets}
              options={panelOptions}
              total={result.total}
            />
          </div>
        </div>
        <ActiveFilters search={search} labels={activeLabels} />
        <PendingRegion>
          <ResultList
            result={result}
            search={search}
            gradeLabels={gradeLabels}
            attachTo={attachTo}
          />
        </PendingRegion>
      </section>
    </div>
  );
}
