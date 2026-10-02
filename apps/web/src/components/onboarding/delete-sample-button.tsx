'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useErrorText } from '@/hooks/use-action';
import { deleteSampleClass } from '@/server/actions/onboarding';

/** « Supprimer la classe exemple »: a simple confirmation (D-109), then « Pour bien commencer ». */
export function DeleteSampleButton({ classId }: { classId: string }) {
  const t = useTranslations('onboarding.sample');
  const errorText = useErrorText();
  const router = useRouter();
  return (
    <ConfirmButton
      label={t('delete')}
      message={t('deleteConfirm')}
      confirmLabel={t('delete')}
      size="md"
      onConfirm={async () => {
        try {
          const result = await deleteSampleClass(classId);
          if (!result.ok) {
            toast.error(errorText(result.error));
            return;
          }
        } catch {
          toast.error(errorText('network'));
          return;
        }
        toast.success(t('deleted'));
        router.push('/demarrage');
      }}
    />
  );
}
