'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';

/**
 * The projector could not load: the session is on the server, so nothing is lost; try again
 * (« Reprendre la projection » on the class tab works too).
 */
export default function ProjectorSessionError({ reset }: { error: Error; reset: () => void }) {
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
