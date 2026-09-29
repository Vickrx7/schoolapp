import { LoaderCircle, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { canGenerate, loadOpenLibraryJobs } from '@/server/queries/library-ai';
import type { SessionContext } from '@/server/session';

/**
 * « Créer avec l’IA » on the library hub (slice S8, D-072): shown only where AI is on for one of
 * the user's library schools, with the requests still being prepared (« En préparation »), each
 * leading to its job page. Rendered by S4's hub page.
 */
export async function HubAiSlot({ session }: { session: SessionContext }) {
  if (!canGenerate(session)) return null;
  const [t, tc, open] = await Promise.all([
    getTranslations('libraryAi.hub'),
    getTranslations('libraryCommon'),
    loadOpenLibraryJobs(),
  ]);
  return (
    <section aria-labelledby="library-ai" className="space-y-3">
      <h2 id="library-ai" className="sr-only">
        {t('title')}
      </h2>
      <Link
        href="/library/generate"
        className="flex min-h-11 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50"
      >
        <Sparkles className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
        <span>
          <span className="block font-medium text-slate-900">{t('title')}</span>
          <span className="mt-0.5 block text-sm text-slate-600">{t('hint')}</span>
        </span>
      </Link>
      {open.length ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">{t('preparing')}</p>
          <ul className="space-y-1">
            {open.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/library/generate/${job.id}`}
                  className="inline-flex min-h-11 items-center gap-2 text-sm text-brand-700 hover:underline"
                >
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  {job.feature === 'library_levels'
                    ? t('preparingLevels')
                    : job.itemType
                      ? t('preparingItem', {
                          type: tc(`types.${job.itemType}` as 'types.quiz'),
                        })
                      : t('preparingOther')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
