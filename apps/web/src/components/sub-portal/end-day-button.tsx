'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { endSubSession } from '@/server/actions/sub-portal';
import { forgetReportDrafts } from './forget-report-drafts';

/**
 * « Terminer ma journée »: ends this device's session and forgets the report kept in this tab,
 * then says goodbye.
 */
export function EndDayButton() {
  const t = useTranslations('subPortal');
  const router = useRouter();
  const end = useAction(endSubSession, {
    onSuccess: () => {
      forgetReportDrafts();
      router.replace('/suppleance?done=1');
    },
  });
  return (
    <Button size="lg" disabled={end.pending} onClick={() => void end.run()}>
      <LogOut aria-hidden />
      {end.pending ? t('ending') : t('endDay')}
    </Button>
  );
}
