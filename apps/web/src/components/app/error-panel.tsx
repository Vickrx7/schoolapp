'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';
import { useErrorReference } from '@/hooks/use-error-reference';

/**
 * What an error page says (DECISIONS D-111): nothing was lost, try again, and the reference to
 * give when reporting the problem, which matches the server's log line.
 */
export function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  const reference = useErrorReference(error);
  return (
    <EmptyState
      title={t('errors.title')}
      body={
        <>
          {t('errors.unexpected')}
          <span className="mt-3 block text-xs text-slate-500" data-testid="error-reference">
            {t('errors.reference', { ref: reference })}
          </span>
        </>
      }
      action={<Button onClick={reset}>{t('common.retry')}</Button>}
    />
  );
}
