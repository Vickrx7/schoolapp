import { ChartColumn } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { coverageHref } from '@/server/library/coverage-view';
import { loadLibrarySearchOptions } from '@/server/queries/library-search';
import type { SessionContext } from '@/server/session';

export interface HubCoverageSlotProps {
  session: SessionContext;
}

/**
 * « Couverture du curriculum » on the library hub (DECISIONS D-094): the link to the attentes
 * with no or few board-approved resources, opened on the user's first grade (like « Parcourir
 * par attente »). Rendered on the server in the hub's browsing section, for everyone who sees
 * the hub (the library's users and reviewers).
 */
export async function HubCoverageSlot({ session }: HubCoverageSlotProps) {
  const [t, locale] = await Promise.all([getTranslations('libraryCoverage'), getLocale()]);
  // Cached per request: the hub has already loaded the same options.
  const options = await loadLibrarySearchOptions(session, locale);
  return (
    <p>
      <Link
        href={coverageHref({ grade: options.myGrades[0] ?? null })}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-700 hover:underline"
      >
        <ChartColumn className="size-5" aria-hidden />
        {t('hubLink')}
      </Link>
    </p>
  );
}
