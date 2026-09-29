'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

/** Something failed on a portal page: the plan was not lost; try again or call the office. */
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <div className="py-4">
      <EmptyState
        title={t('errors.title')}
        body={t('errors.unexpected')}
        action={<Button onClick={reset}>{t('common.retry')}</Button>}
      />
    </div>
  );
}
