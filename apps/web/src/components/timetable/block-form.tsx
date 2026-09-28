'use client';

import { blockKinds } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { deleteTimetableBlock, saveTimetableBlock } from '@/server/actions/timetable';
import type { SubjectOption } from '@/server/queries/subjects';
import type { BoardBlock } from './timetable-board';

export function BlockForm({
  classId,
  block,
  days,
  dayLabel,
  subjects,
  team,
  rooms,
  defaults,
  onDone,
}: {
  classId: string;
  block: BoardBlock | null;
  days: number[];
  dayLabel: (d: number) => string;
  subjects: SubjectOption[];
  team: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  defaults: { start: string; end: string };
  onDone: () => void;
}) {
  const t = useTranslations('timetable');
  const tCommon = useTranslations('common');
  const [dayKeys, setDayKeys] = useState<number[]>(block ? [block.dayKey] : days.slice(0, 5));
  const [startTime, setStartTime] = useState(block?.startTime ?? defaults.start);
  const [endTime, setEndTime] = useState(block?.endTime ?? '');
  const [kind, setKind] = useState<(typeof blockKinds)[number]>(block?.kind ?? 'subject');
  const [subjectId, setSubjectId] = useState(block?.subjectId ?? '');
  const [title, setTitle] = useState(block?.title ?? '');
  const [teacherId, setTeacherId] = useState(block?.teacherId ?? '');
  const [roomId, setRoomId] = useState(block?.roomId ?? '');
  const [notes, setNotes] = useState(block?.notes ?? '');

  const save = useAction(saveTimetableBlock, { successMessage: t('saved'), onSuccess: onDone });
  const remove = useAction(deleteTimetableBlock, {
    successMessage: t('deleted'),
    onSuccess: onDone,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(
      {
        classId,
        dayKeys,
        startTime,
        endTime,
        kind,
        subjectId: kind === 'subject' ? subjectId || null : null,
        title: title || null,
        teacherId: teacherId || null,
        roomId: roomId || null,
        notes: notes || null,
      },
      block?.id,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">{t('days')}</legend>
        {!block ? <p className="text-sm text-slate-500">{t('daysHint')}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {days.map((d) => (
            <label
              key={d}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm capitalize has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
            >
              <input
                type={block ? 'radio' : 'checkbox'}
                name="day"
                className="size-4"
                checked={dayKeys.includes(d)}
                onChange={() =>
                  setDayKeys((prev) =>
                    block
                      ? [d]
                      : prev.includes(d)
                        ? prev.filter((x) => x !== d)
                        : [...prev, d].sort((a, b) => a - b),
                  )
                }
              />
              {dayLabel(d)}
            </label>
          ))}
        </div>
        {save.fieldError('dayKeys') ? (
          <p className="mt-1 text-sm text-red-600">{save.fieldError('dayKeys')}</p>
        ) : null}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('start')} htmlFor="block-start" error={save.fieldError('startTime')}>
          <Input
            id="block-start"
            type="time"
            step={300}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </Field>
        <Field label={t('end')} htmlFor="block-end" error={save.fieldError('endTime')}>
          <Input
            id="block-end"
            type="time"
            step={300}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label={t('kind')} htmlFor="block-kind">
        <Select
          id="block-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof blockKinds)[number])}
        >
          {blockKinds.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
      </Field>

      {kind === 'subject' ? (
        <Field label={t('subject')} htmlFor="block-subject" error={save.fieldError('subjectId')}>
          <Select
            id="block-subject"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            required
          >
            <option value="">{t('chooseSubject')}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field
          label={`${t('blockTitle')} (${tCommon('optional')})`}
          htmlFor="block-title"
          hint={t('blockTitleHint')}
        >
          <Input
            id="block-title"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('teacher')} htmlFor="block-teacher">
          <Select
            id="block-teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
          >
            <option value="">{t('homeroomTeacher')}</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('room')} htmlFor="block-room">
          <Select id="block-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">{t('sameRoom')}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={`${t('notes')} (${tCommon('optional')})`} htmlFor="block-notes">
        <Textarea
          id="block-notes"
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-16"
        />
      </Field>

      <div className="flex items-center justify-between gap-2 pt-2">
        {block ? (
          <ConfirmButton
            label={tCommon('delete')}
            message={t('deleteConfirm')}
            confirmLabel={tCommon('delete')}
            variant="ghost"
            onConfirm={() => remove.run(classId, block.id)}
          />
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={save.pending}>
            {save.pending ? tCommon('saving') : tCommon('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
