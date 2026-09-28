'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { formatLocalDate } from '@/lib/format';
import { addCycleAnchor, deleteCycleAnchor, updateSchoolSettings } from '@/server/actions/school';

export function SchoolSettingsForm({
  school,
  anchors,
}: {
  school: {
    id: string;
    name: string;
    scheduleType: 'weekly' | 'cycle';
    cycleLength: number | null;
    studentAlertsEnabled: boolean;
    canEditSettings: boolean;
  };
  anchors: { id: string; date: string; day: number }[];
}) {
  const t = useTranslations('school');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [scheduleType, setScheduleType] = useState(school.scheduleType);
  const [cycleLength, setCycleLength] = useState(String(school.cycleLength ?? 5));
  const [alerts, setAlerts] = useState(school.studentAlertsEnabled);
  const [anchorDate, setAnchorDate] = useState('');
  const [anchorDay, setAnchorDay] = useState('1');
  const save = useAction(updateSchoolSettings, { successMessage: t('saved') });
  const addAnchor = useAction(addCycleAnchor, {
    successMessage: t('saved'),
    onSuccess: () => setAnchorDate(''),
  });
  const removeAnchor = useAction(deleteCycleAnchor, { successMessage: t('saved') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(school.id, {
      scheduleType,
      cycleLength: scheduleType === 'cycle' ? Number(cycleLength) : null,
      studentAlertsEnabled: alerts,
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{school.name}</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={!school.canEditSettings} className="space-y-4">
              <Field label={t('scheduleType')} htmlFor={`schedule-${school.id}`}>
                <Select
                  id={`schedule-${school.id}`}
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as 'weekly' | 'cycle')}
                >
                  <option value="weekly">{t('weekly')}</option>
                  <option value="cycle">{t('cycle')}</option>
                </Select>
              </Field>
              {scheduleType === 'cycle' ? (
                <Field
                  label={t('cycleLength')}
                  htmlFor={`cycle-${school.id}`}
                  error={save.fieldError('cycleLength')}
                  className="max-w-40"
                >
                  <Input
                    id={`cycle-${school.id}`}
                    type="number"
                    min={2}
                    max={20}
                    value={cycleLength}
                    onChange={(e) => setCycleLength(e.target.value)}
                  />
                </Field>
              ) : null}
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">{t('alerts')}</p>
                <p className="text-sm text-slate-500">{t('alertsHelp')}</p>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={alerts}
                    onChange={(e) => setAlerts(e.target.checked)}
                  />
                  {t('alertsEnabled')}
                </label>
              </div>
              {school.canEditSettings ? (
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

      {school.scheduleType === 'cycle' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('anchors')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-600">{t('anchorsHelp')}</p>
            <ul className="divide-y divide-slate-100">
              {anchors.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {formatLocalDate(a.date, locale)} → <strong>{a.day}</strong>
                  </span>
                  <ConfirmButton
                    label={tCommon('delete')}
                    message={formatLocalDate(a.date, locale)}
                    confirmLabel={tCommon('delete')}
                    variant="ghost"
                    onConfirm={() => removeAnchor.run(a.id)}
                  />
                </li>
              ))}
            </ul>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addAnchor.run(school.id, { anchorDate, cycleDay: Number(anchorDay) });
              }}
            >
              <Field label={t('anchorDate')} htmlFor={`anchor-date-${school.id}`}>
                <Input
                  id={`anchor-date-${school.id}`}
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                />
              </Field>
              <Field label={t('anchorDay')} htmlFor={`anchor-day-${school.id}`} className="w-28">
                <Input
                  id={`anchor-day-${school.id}`}
                  type="number"
                  min={1}
                  max={school.cycleLength ?? 20}
                  value={anchorDay}
                  onChange={(e) => setAnchorDay(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={!anchorDate || addAnchor.pending}>
                {t('addAnchor')}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
