import { LIBRARY_BUCKETS, typesOf } from '@lynx/content';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * « Nouvelle ressource »: the 25 types by category, each with its one-line hint, as links to the
 * editor (`/library/new?type=…`, keeping the grade and subject it was opened with).
 */
export function TypeGrid({ query }: { query: string }) {
  const tc = useTranslations('libraryCommon');
  return (
    <div className="space-y-6">
      {LIBRARY_BUCKETS.map((bucket) => (
        <section key={bucket} aria-labelledby={`bucket-${bucket}`} className="space-y-2">
          <h2 id={`bucket-${bucket}`} className="text-base font-semibold text-slate-900">
            {tc(`buckets.${bucket}`)}
            <span className="ml-2 text-sm font-normal text-slate-600">
              {tc(`bucketHints.${bucket}`)}
            </span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {typesOf(bucket).map((type) => (
              <li key={type}>
                <Link
                  href={`/library/new?type=${type}${query ? `&${query}` : ''}`}
                  className="flex h-full min-h-11 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50"
                >
                  <span className="font-medium text-slate-900">{tc(`types.${type}`)}</span>
                  <span className="text-sm text-slate-600">{tc(`typeHints.${type}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
