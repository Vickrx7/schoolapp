import { ClipboardCheck, FolderOpen, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { loadMyLibrary, loadReviewQueues, mineTabOf } from '@/server/queries/library-authoring';
import { librarySchools, type SessionContext } from '@/server/session';

const card =
  'flex min-h-11 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50';

/**
 * On the library hub (slice S6, D-063, D-064): « Créer une ressource » and the « Mes ressources »
 * card (« 2 brouillons · 1 à retravailler · 1 en préparation ») for teachers and direction of a
 * library school, and « Approbation des ressources » with its queues for the board's designated
 * reviewers. Rendered by S4's hub page.
 */
export async function HubCreateSlot({ session }: { session: SessionContext }) {
  const author = librarySchools(session).length > 0;
  const reviewer = session.libraryReviewer.length > 0;
  if (!author && !reviewer) return null;
  const [t, mine, queues] = await Promise.all([
    getTranslations('libraryEdit.hub'),
    author ? loadMyLibrary(session) : Promise.resolve(null),
    reviewer ? loadReviewQueues(session) : Promise.resolve(null),
  ]);
  const counts = { drafts: 0, rework: 0 };
  for (const item of mine?.items ?? []) {
    const tab = mineTabOf(item);
    if (tab === 'drafts' || tab === 'rework') counts[tab] += 1;
  }
  const summary = [
    t('drafts', { count: counts.drafts }),
    ...(counts.rework ? [t('rework', { count: counts.rework })] : []),
    ...(mine?.preparing.length ? [t('preparing', { count: mine.preparing.length })] : []),
  ].join(' · ');

  return (
    <section aria-labelledby="library-mine" className="space-y-3">
      <h2 id="library-mine" className="text-base font-semibold text-slate-900">
        {t('title')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {author ? (
          <>
            <li>
              <Link href="/library/new" className={card}>
                <Plus className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                <span>
                  <span className="block font-medium text-slate-900">{t('create')}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">{t('createHint')}</span>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/library/mine" className={card}>
                <FolderOpen className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                <span>
                  <span className="block font-medium text-slate-900">{t('mine')}</span>
                  <span className="mt-0.5 block text-sm text-slate-600 tabular-nums">
                    {summary}
                  </span>
                </span>
              </Link>
            </li>
          </>
        ) : null}
        {queues ? (
          <li>
            <Link href="/library/review" className={card}>
              <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
              <span>
                <span className="block font-medium text-slate-900">{t('review')}</span>
                <span className="mt-0.5 block text-sm text-slate-600 tabular-nums">
                  {[
                    ...(queues.content ? [t('toApprove', { count: queues.content.length })] : []),
                    ...(queues.faith ? [t('toFaith', { count: queues.faith.length })] : []),
                  ].join(' · ')}
                </span>
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
