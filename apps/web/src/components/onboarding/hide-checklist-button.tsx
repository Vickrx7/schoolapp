'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { setOnboardingHidden } from '@/server/actions/onboarding';

/**
 * « Masquer » the checklist on « Aujourd'hui », or show it there again (D-109). Once hidden, a
 * toast says where it stays: « Profil » links to it.
 */
export function HideChecklistButton({ hidden }: { hidden: boolean }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const save = useAction(setOnboardingHidden, {
    successMessage: hidden ? undefined : t('hiddenToast'),
    onSuccess: () => router.refresh(),
  });
  return (
    <Button
      variant={hidden ? 'secondary' : 'ghost'}
      disabled={save.pending}
      onClick={() => void save.run(!hidden)}
    >
      {hidden ? t('showOnToday') : t('hide')}
    </Button>
  );
}
