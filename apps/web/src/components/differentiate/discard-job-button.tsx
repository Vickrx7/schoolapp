'use client';

import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { discardAiJob } from '@/server/actions/differentiate';

export function DiscardJobButton({ jobId }: { jobId: string }) {
  const t = useTranslations('differentiate');
  const discard = useAction(discardAiJob);
  return (
    <ConfirmButton
      label={t('discard')}
      message={t('discardConfirm')}
      confirmLabel={t('discard')}
      variant="ghost"
      onConfirm={() => discard.run(jobId)}
    />
  );
}
