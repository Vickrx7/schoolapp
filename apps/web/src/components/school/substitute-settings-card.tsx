'use client';

import type { SchoolSettings } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { updateSubstituteSettings } from '@/server/actions/school';

/**
 * The direction's « Suppléance » card: when substitutes' codes work, where morning ends for
 * half-day absences, and what every plan of the school says about arriving and emergencies.
 * Office staff see it read-only.
 */
export function SubstituteSettingsCard({
  school,
  canEdit,
}: {
  school: { id: string; name: string; substitute: SchoolSettings['substitute'] };
  canEdit: boolean;
}) {
  const t = useTranslations('schoolSubstitute');
  const tCommon = useTranslations('common');
  const s = school.substitute;
  const [accessFrom, setAccessFrom] = useState(s.accessFrom);
  const [accessUntil, setAccessUntil] = useState(s.accessUntil);
  const [halfDaySplit, setHalfDaySplit] = useState(s.halfDaySplit ?? '');
  const [arrival, setArrival] = useState(s.arrivalInstructions ?? '');
  const [emergency, setEmergency] = useState(s.emergencyInfo ?? '');
  const save = useAction(updateSubstituteSettings, { successMessage: t('saved') });
  const id = (field: string) => `sub-settings-${field}-${school.id}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run({
      schoolId: school.id,
      accessFrom,
      accessUntil,
      halfDaySplit,
      arrivalInstructions: arrival,
      emergencyInfo: emergency,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('title')} · {school.name}
        </CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">{t('intro')}</p>
          {!canEdit ? <p className="text-sm text-slate-500">{t('onlyDirection')}</p> : null}
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t('accessFrom')}
                htmlFor={id('from')}
                error={save.fieldError('accessFrom')}
              >
                <Input
                  id={id('from')}
                  type="time"
                  value={accessFrom}
                  onChange={(e) => setAccessFrom(e.target.value)}
                />
              </Field>
              <Field
                label={t('accessUntil')}
                htmlFor={id('until')}
                error={save.fieldError('accessUntil')}
              >
                <Input
                  id={id('until')}
                  type="time"
                  value={accessUntil}
                  onChange={(e) => setAccessUntil(e.target.value)}
                />
              </Field>
              <Field
                label={`${t('halfDaySplit')} (${tCommon('optional')})`}
                htmlFor={id('split')}
                error={save.fieldError('halfDaySplit')}
              >
                <Input
                  id={id('split')}
                  type="time"
                  value={halfDaySplit}
                  onChange={(e) => setHalfDaySplit(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-sm text-slate-500">
              {t('accessHint')} {t('halfDaySplitHint')}
            </p>
            <Field
              label={`${t('arrivalInstructions')} (${tCommon('optional')})`}
              htmlFor={id('arrival')}
              hint={t('arrivalInstructionsHint')}
              error={save.fieldError('arrivalInstructions')}
            >
              <Textarea
                id={id('arrival')}
                value={arrival}
                maxLength={500}
                className="min-h-16"
                onChange={(e) => setArrival(e.target.value)}
              />
            </Field>
            <Field
              label={`${t('emergencyInfo')} (${tCommon('optional')})`}
              htmlFor={id('emergency')}
              hint={t('emergencyInfoHint')}
              error={save.fieldError('emergencyInfo')}
            >
              <Textarea
                id={id('emergency')}
                value={emergency}
                maxLength={500}
                className="min-h-16"
                onChange={(e) => setEmergency(e.target.value)}
              />
            </Field>
            {canEdit ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={save.pending}>
                  {save.pending ? tCommon('saving') : tCommon('save')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        </form>
      </CardBody>
    </Card>
  );
}
