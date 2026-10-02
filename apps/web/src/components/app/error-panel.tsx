'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFeedback } from '@/components/feedback/feedback-provider';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';
import { useErrorReference } from '@/hooks/use-error-reference';

/**
 * What an error page says (DECISIONS D-111): nothing was lost, try again, and the reference to
 * give when reporting the problem, which matches the server's log line. « Signaler ce problème »
 * opens « Commentaires » with the reference filled in (D-116) for signed-in staff (the app, the
 * projector); on the substitute portal, which has no account, it says to give the reference to
 * the school office.
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
  const feedback = useFeedback();
  const [help, setHelp] = useState(false);
  return (
    <EmptyState
      title={t('errors.title')}
      body={
        <>
          {t('errors.unexpected')}
          <span className="mt-3 block text-xs text-slate-500" data-testid="error-reference">
            {t('errors.reference', { ref: reference })}
          </span>
          {help ? (
            <span role="status" className="mt-3 block text-sm text-slate-700">
              {t('problemReport.officeHelp', { ref: reference })}
            </span>
          ) : null}
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>{t('common.retry')}</Button>
          <Button
            variant="secondary"
            onClick={() => (feedback ? feedback.open(reference) : setHelp(true))}
          >
            {t('errors.reportProblem')}
          </Button>
        </div>
      }
    />
  );
}
