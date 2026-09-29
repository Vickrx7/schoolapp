import { Layers } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HubAiSlot } from '@/components/library/slots/hub-ai-slot';
import { HubCreateSlot } from '@/components/library/slots/hub-create-slot';
import { PageHeader } from '@/components/ui/page';
import { aiSchools, librarySchools, requireSession, showLibrary } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('library');
  return { title: t('title') };
}

/**
 * « Banque de ressources » (`/library`, DECISIONS D-078), where « Ressources » in the navigation
 * leads: for users of a library school and for designated reviewers; office staff get not
 * found. It links to « Texte différencié », which left the navigation when the library came in
 * (where AI can be used, as on `/differentiate`), and holds the creation slots. Search, the
 * category tiles and results (slice S4) are added to this page.
 */
export default async function LibraryHubPage() {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const t = await getTranslations('library');
  const differentiate = aiSchools(session).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('intro')} />
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
