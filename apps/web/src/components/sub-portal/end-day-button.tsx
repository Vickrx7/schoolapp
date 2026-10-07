'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { endSubSession } from '@/server/actions/sub-portal';
import { forgetReportDrafts } from './forget-report-drafts';

/**
 * « Terminer ma journée »: ends this device's session and forgets the report kept in this tab,
 * then says goodbye. While the report is not sent (`reportSent` false) it asks first, since
 * this device then needs the code again to send it.
 */
export function EndDayButton({ reportSent }: { reportSent: boolean }) {
  const t = useTranslations('subPortal');
  const router = useRouter();
  const end = useAction(endSubSession, {
    onSuccess: () => {
      forgetReportDrafts();
      router.replace('/suppleance?done=1');
    },
  });
  if (!reportSent) {
    return (
      <ConfirmButton
        label={t('endDay')}
        message={t('endDayUnsent')}
        confirmLabel={t('endDayAnyway')}
        size="md"
        disabled={end.pending}
        onConfirm={() => end.run()}
      />
    );
  }
  return (
    <Button size="lg" disabled={end.pending} onClick={() => void end.run()}>
      <LogOut aria-hidden />
      {end.pending ? t('ending') : t('endDay')}
    </Button>
  );
}
