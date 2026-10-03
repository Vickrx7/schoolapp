'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { releaseSubPlan } from '@/server/actions/sub-plans';

/** « Publier maintenant »: releases the plan before its automatic time (one tap). */
export function ReleaseButton({
  planId,
  variant = 'primary',
}: {
  planId: string;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTranslations('subPlan');
  const release = useAction(releaseSubPlan, { successMessage: t('published') });
  return (
    <Button variant={variant} disabled={release.pending} onClick={() => void release.run(planId)}>
      <Send aria-hidden />
      {t('publishNow')}
    </Button>
  );
}
