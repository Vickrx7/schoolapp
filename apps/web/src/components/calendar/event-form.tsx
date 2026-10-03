'use client';

import { calendarEventTypes } from '@lynx/domain';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { saveCalendarEvent } from '@/server/actions/calendar';

/** Board-wide (`boardId`), a school, or one of its classes (`schoolId` and `classId`). */
type Scope = {
  key: string;
  boardId: string | null;
  schoolId: string | null;
  classId: string | null;
  label: string;
};

/** What a new event of this scope starts as: a board adds PA days and holidays. */
const defaultType = (scope: Scope | undefined) =>
  scope?.classId ? 'field_trip' : scope?.boardId ? 'pa_day' : 'assembly';

export function EventForm({ scopes, defaultDate }: { scopes: Scope[]; defaultDate: string }) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [scopeKey, setScopeKey] = useState(scopes[0]?.key ?? '');
  const scope = scopes.find((s) => s.key === scopeKey) ?? scopes[0]!;
  const classOnly = scope.classId !== null;
  const types = classOnly
    ? (['field_trip', 'mass', 'liturgy', 'other'] as const)
    : calendarEventTypes;
  const [eventType, setEventType] = useState<(typeof calendarEventTypes)[number]>(
    defaultType(scope),
  );
  const [title, setTitle] = useState('');
  const [startsOn, setStartsOn] = useState(defaultDate);
  const [endsOn, setEndsOn] = useState(defaultDate);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [affectsSchedule, setAffectsSchedule] = useState(true);
  const [notes, setNotes] = useState('');

  const save = useAction(saveCalendarEvent, {
    successMessage: t('saved'),
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      setNotes('');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run({
      boardId: scope.boardId,
      schoolId: scope.schoolId,
      classId: scope.classId,
      eventType,
      title: title || t(`types.${eventType}`),
      startsOn,
      endsOn: endsOn < startsOn ? startsOn : endsOn,
      startTime: startTime || null,
      endTime: endTime || null,
      affectsSchedule,
      notes: notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('add')} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {scopes.length > 1 ? (
            <Field label={t('scope')} htmlFor="event-scope">
              <Select
                id="event-scope"
                value={scopeKey}
                onChange={(e) => {
                  setScopeKey(e.target.value);
                  setEventType(defaultType(scopes.find((s) => s.key === e.target.value)));
                }}
              >
                {scopes.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : scope.boardId ? (
            // A board admin's only choice: say the event is for the whole board.
            <p className="text-sm text-slate-700">{t('scopeLine', { scope: scope.label })}</p>
          ) : null}
          <Field label={t('type')} htmlFor="event-type">
            <Select
              id="event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as (typeof calendarEventTypes)[number])}
            >
              {types.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`types.${ty}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('eventTitle')} htmlFor="event-title" error={save.fieldError('title')}>
            <Input
              id="event-title"
              value={title}
              maxLength={120}
              placeholder={t(`types.${eventType}`)}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('startsOn')} htmlFor="event-starts" error={save.fieldError('startsOn')}>
              <Input
                id="event-starts"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </Field>
            <Field label={t('endsOn')} htmlFor="event-ends" error={save.fieldError('endsOn')}>
              <Input
                id="event-ends"
                type="date"
                value={endsOn}
                min={startsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('startTime')} htmlFor="event-start-time">
              <Input
                id="event-start-time"
                type="time"
                step={300}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label={t('endTime')} htmlFor="event-end-time" error={save.fieldError('endTime')}>
              <Input
                id="event-end-time"
                type="time"
                step={300}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-sm text-slate-500">{t('timesHint')}</p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={affectsSchedule}
              onChange={(e) => setAffectsSchedule(e.target.checked)}
            />
            {t('affectsSchedule')}
          </label>
          <Field label={`${t('notes')} (${tCommon('optional')})`} htmlFor="event-notes">
            <Textarea
              id="event-notes"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-16"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={save.pending}>
              {save.pending ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
