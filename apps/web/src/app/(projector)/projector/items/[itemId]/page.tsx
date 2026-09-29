import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { SlidesPlayer } from '@/components/class-mode/presenter/slides-player';
import { buildPresentation, isPresentable } from '@/server/class-mode/presenter';
import { loadSlideMessages } from '@/server/class-mode/slide-messages';
import { loadPresenterSource } from '@/server/queries/class-mode-present';
import { getSession, librarySchools, requireSession } from '@/server/session';

type Props = {
  params: Promise<{ itemId: string }>;
  /** `v`: the version chosen on the item page; `s`: the slide, from 1. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('classPresenter');
  const { itemId } = await params;
  const session = await getSession();
  if (!session || !z.uuid().safeParse(itemId).success) return { title: t('title') };
  const source = await loadPresenterSource(itemId, session);
  return { title: source ? t('pageTitle', { title: source.title }) : t('title') };
}

/**
 * « Présenter à la classe » (DECISIONS D-082, D-086, D-090): `/projector/items/<id>?v=<version>&s=<n>`.
 * For library users (teachers and direction at a school with the Library module) and an item
 * they can use in class; anything else is not found. It writes nothing: no session, no audit.
 *
 * The slides are built here, on the server, from the version's student content
 * (`presentSlides`), and the player receives only them and the slide labels in the content's
 * language: the page's payload never holds the item, a teacher-only field, the safety notes, a
 * level name or an answer key. « Afficher la réponse » fetches one answer when asked.
 */
export default async function PresenterPage({ params, searchParams }: Props) {
  const session = await requireSession();
  if (!librarySchools(session).length) notFound();
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const [source, query] = await Promise.all([loadPresenterSource(itemId, session), searchParams]);
  if (!source || !isPresentable(source)) notFound();

  const presentation = buildPresentation(source, {
    versionId: first(query.v),
    slide: first(query.s),
  });
  if (!presentation) notFound();
  const slideMessages = await loadSlideMessages(presentation.lang);

  return (
    <SlidesPlayer
      itemId={source.id}
      versionId={presentation.versionId}
      title={presentation.title}
      slides={presentation.slides}
      lang={presentation.lang}
      slideMessages={slideMessages}
      initialIndex={presentation.index}
      exitHref={`/library/items/${source.id}?v=${presentation.versionId}`}
      partial={presentation.partial}
      hasKey={presentation.hasKey}
    />
  );
}
