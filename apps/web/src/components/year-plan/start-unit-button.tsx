'use client';

import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { startPlannedUnit } from '@/server/actions/year-plan';

/**
 * « Commencer l'unité » on « Aujourd'hui » (DECISIONS D-126): the planned unit becomes the
 * subject's unit under way. With `finishCurrent`, « Terminer et commencer « … » »: the unit whose
 * lessons are all given is marked finished first. Units never start by themselves (D-123).
 */
export function StartUnitButton({
  classId,
  unitId,
  title,
  finishCurrent = false,
}: {
  classId: string;
  unitId: string;
  title: string;
  finishCurrent?: boolean;
}) {
  const t = useTranslations('today.plannedUnit');
  const start = useAction(startPlannedUnit, { successMessage: t('started', { title }) });
  return (
    <Button
      variant="secondary"
      disabled={start.pending}
      onClick={() => void start.run(classId, unitId, finishCurrent)}
    >
      <Play aria-hidden />
      {finishCurrent ? t('finishAndStart', { title }) : t('start')}
    </Button>
  );
}
