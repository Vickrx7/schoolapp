import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <EmptyState
      as="h1"
      title={t('pageNotFound')}
      action={
        <Button asChild>
          <Link href="/">{t('goHome')}</Link>
        </Button>
      }
    />
  );
}
