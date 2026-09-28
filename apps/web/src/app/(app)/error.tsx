'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <EmptyState
      title={t('errors.title')}
      body={t('errors.unexpected')}
      action={<Button onClick={reset}>{t('common.retry')}</Button>}
    />
  );
}
