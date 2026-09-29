'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { markPlannedLessonsTaught } from '@/server/actions/sub-reports';

/**
 * « Aucun suivi reçu » → « Marquer les leçons prévues comme données »: the day's planned
 * lessons are checked off on the plan date, as the teacher would do herself.
 */
export function MarkPlannedButton({ planId, count }: { planId: string; count: number }) {
  const t = useTranslations('subReport');
  const router = useRouter();
  const mark = useAction(markPlannedLessonsTaught, {
    onSuccess: ({ marked }) => {
      toast.success(t('markedPlanned', { count: marked }));
      router.refresh();
    },
  });
  return (
    <ConfirmButton
      label={t('markPlanned')}
      message={t('markPlannedConfirm', { count })}
      confirmLabel={t('markPlanned')}
      tone="primary"
      size="md"
      disabled={mark.pending}
      onConfirm={() => mark.run(planId)}
    />
  );
}
