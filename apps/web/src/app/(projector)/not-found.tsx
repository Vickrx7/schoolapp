import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

/** A projector page the user cannot open (not readable, not presentable): as in the app. */
export default async function ProjectorNotFound() {
  const t = await getTranslations('errors');
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={t('pageNotFound')}
        action={
          <Button asChild>
            <Link href="/today">{t('goToday')}</Link>
          </Button>
        }
      />
    </div>
  );
}
