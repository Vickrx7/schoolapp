'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { saveUnitDates } from '@/server/actions/year-plan';

/**
 * « Enregistrer ces dates » (DECISIONS D-126): saves the weeks « Mon année » shows for a unit
 * dated from its lessons. Nothing is saved until the teacher taps it.
 */
export function SaveDatesButton({
  classId,
  unitId,
  title,
  startsOn,
  endsOn,
}: {
  classId: string;
  unitId: string;
  title: string;
  startsOn: string;
  endsOn: string;
}) {
  const t = useTranslations('yearPlan.inferred');
  const save = useAction(saveUnitDates, { successMessage: t('saved') });
  return (
    <Button
      size="md"
      disabled={save.pending}
      aria-label={t('saveLabel', { title })}
      onClick={() => void save.run(classId, unitId, { startsOn, endsOn })}
    >
      {t('save')}
    </Button>
  );
}
