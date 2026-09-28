'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { createClass, updateClass } from '@/server/actions/classes';
import type { ClassFormOptions } from '@/server/queries/classes';

export function ClassForm({
  options,
  initial,
  classId,
  onDone,
}: {
  options: ClassFormOptions;
  initial?: { name: string; schoolId: string; roomId: string | null; gradeCodes: string[] };
  classId?: string;
  onDone?: () => void;
}) {
  const t = useTranslations('classes');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? options.schools[0]?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [gradeCodes, setGradeCodes] = useState<string[]>(initial?.gradeCodes ?? []);
  const [roomId, setRoomId] = useState<string>(initial?.roomId ?? '');
  const school = options.schools.find((s) => s.id === schoolId);
  const years = options.schoolYears.filter((y) => y.boardId === school?.boardId);
  const [chosenYearId, setSchoolYearId] = useState('');
  // Default to the most recent year of the selected school's board.
  const schoolYearId = years.some((y) => y.id === chosenYearId)
    ? chosenYearId
    : (years[0]?.id ?? '');
  const rooms = options.rooms.filter((r) => r.schoolId === schoolId);

  const create = useAction(createClass, {
    successMessage: t('created'),
    onSuccess: ({ id }) => {
      onDone?.();
      router.push(`/classes/${id}/students`);
    },
  });
  const update = useAction(updateClass, {
    successMessage: tCommon('saved'),
    onSuccess: () => onDone?.(),
  });
  const action = classId ? update : create;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (classId) void update.run(classId, { name, roomId: roomId || null, gradeCodes });
    else void create.run({ name, schoolId, schoolYearId, gradeCodes, roomId: roomId || null });
  };

  const toggleGrade = (code: string) =>
    setGradeCodes((prev) =>
      prev.includes(code) ? prev.filter((g) => g !== code) : [...prev, code],
    );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!classId && options.schools.length > 1 ? (
        <Field label={t('school')} htmlFor="class-school">
          <Select id="class-school" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            {options.schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field
        label={t('name')}
        htmlFor="class-name"
        hint={t('nameHint')}
        error={action.fieldError('name')}
      >
        <Input
          id="class-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t('grades')}</legend>
        <p className="text-sm text-slate-500">{t('gradesHint')}</p>
        <div className="flex flex-wrap gap-2">
          {options.grades.map((g) => (
            <label
              key={g.code}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
            >
              <input
                type="checkbox"
                checked={gradeCodes.includes(g.code)}
                onChange={() => toggleGrade(g.code)}
                className="size-4"
              />
              {g.label}
            </label>
          ))}
        </div>
        {action.fieldError('gradeCodes') ? (
          <p className="text-sm text-red-600" role="alert">
            {action.fieldError('gradeCodes')}
          </p>
        ) : null}
      </fieldset>
      {!classId ? (
        <Field label={t('schoolYear')} htmlFor="class-year">
          <Select
            id="class-year"
            value={schoolYearId}
            onChange={(e) => setSchoolYearId(e.target.value)}
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={`${t('room')} (${tCommon('optional')})`} htmlFor="class-room">
        <Select id="class-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">{tCommon('none')}</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={action.pending}>
          {action.pending ? tCommon('saving') : classId ? tCommon('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
