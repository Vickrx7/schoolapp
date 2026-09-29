import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { libraryHref, withChanges, type LibrarySearch } from '@/server/library/search-params';

export interface ActiveFilterLabels {
  grade: string | null;
  subject: string | null;
  strand: { code: string } | null;
  expectation: { code: string; kind: 'overall' | 'specific' } | null;
}

/**
 * What the results are limited to besides the filter panel's choices, as chips that remove
 * themselves: the grade, subject, domaine or attente a link came with (« Parcourir le
 * curriculum », Planification) and « Mes ressources ».
 */
export function ActiveFilters({
  search,
  labels,
}: {
  search: LibrarySearch;
  labels: ActiveFilterLabels;
}) {
  const t = useTranslations('library.active');
  const tc = useTranslations('libraryCommon');
  const chips: { key: string; label: string; href: string }[] = [];
  const add = (key: string, label: string | null, changes: Partial<LibrarySearch>) => {
    if (label) chips.push({ key, label, href: libraryHref(withChanges(search, changes)) });
  };
  if (search.grade) add('grade', labels.grade ?? search.grade, { grade: null });
  if (search.subject) add('subject', labels.subject, { subject: null });
  if (search.strand) add('strand', labels.strand && t('strand', labels.strand), { strand: null });
  if (search.exp) {
    add(
      'exp',
      labels.expectation &&
        t('expectation', {
          kind: tc(`expectationKinds.${labels.expectation.kind}`),
          code: labels.expectation.code,
        }),
      { exp: null },
    );
  }
  if (search.mine) add('mine', t('mine'), { mine: false });
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p id="library-active-filters" className="text-sm text-slate-600">
        {t('label')}
      </p>
      <ul aria-labelledby="library-active-filters" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              scroll={false}
              aria-label={t('remove', { label: chip.label })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand-600 bg-brand-50 pr-3 pl-4 text-sm font-medium text-brand-800 hover:bg-brand-100"
            >
              {chip.label}
              <X className="size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
