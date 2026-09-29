'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

/** The presentation could not be built: nothing was lost (it writes nothing); try again. */
export default function PresenterError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={t('errors.title')}
        body={t('errors.unexpected')}
        action={<Button onClick={reset}>{t('common.retry')}</Button>}
      />
    </div>
  );
}
