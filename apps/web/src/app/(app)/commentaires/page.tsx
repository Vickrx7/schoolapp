import { isReference } from '@lynx/observability';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FeedbackForm } from '@/components/feedback/feedback-form';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('feedback');
  return { title: t('title') };
}

/**
 * « Envoyer un commentaire » as a page (DECISIONS D-111, D-116): where the last-resort error page
 * (`global-error.tsx`), which has nothing of the app around it, sends « Signaler ce problème »
 * with its reference (`?ref=`, kept only when it has a reference's shape). The header's
 * « Commentaires » opens the same form in a dialog.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const session = await requireSession();
  const { ref } = await searchParams;
  const t = await getTranslations('feedback');
  const reference = isReference(ref) ? ref : null;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <Card className="p-4">
        {/* An error page sent the person here: what to describe. An idea needs no such advice. */}
        {reference ? <p className="mb-4 text-sm text-slate-600">{t('pageIntro')}</p> : null}
        <FeedbackForm userId={session.userId} initialRef={reference} />
      </Card>
    </div>
  );
}
