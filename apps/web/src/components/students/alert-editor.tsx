'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import {
  deleteStudentAlert,
  saveStudentAlert,
  type StudentAlertView,
} from '@/server/actions/students';

const CATEGORIES = ['allergy', 'medical', 'safety', 'other'] as const;

/** Shows one alert (with edit/delete) or, without `alert`, an "add alert" control. */
export function AlertEditor({
  classId,
  studentId,
  alert,
  onChanged,
}: {
  classId: string;
  studentId: string;
  alert?: StudentAlertView;
  onChanged: () => void;
}) {
  const t = useTranslations('students.alerts');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(
    alert?.category ?? 'allergy',
  );
  const [text, setText] = useState(alert?.text ?? '');
  const save = useAction(saveStudentAlert, {
    successMessage: t('saved'),
    onSuccess: () => {
      setEditing(false);
      if (!alert) setText('');
      onChanged();
    },
  });
  const remove = useAction(deleteStudentAlert, {
    successMessage: t('deleted'),
    onSuccess: onChanged,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(classId, { studentId, alertId: alert?.alertId ?? null, category, text });
  };

  if (!editing) {
    if (!alert) {
      return (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {t('add')}
        </Button>
      );
    }
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <Badge tone="danger">{t(`categories.${alert.category}`)}</Badge>
        <span className="text-slate-800">{alert.text ?? t('unreadable')}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          disabled={alert.text === null}
        >
          {tCommon('edit')}
        </Button>
        <ConfirmButton
          label={tCommon('delete')}
          message={t('deleteConfirm')}
          confirmLabel={tCommon('delete')}
          variant="ghost"
          onConfirm={() => remove.run(classId, alert.alertId)}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3"
    >
      <Field label={t('category')} htmlFor={`alert-cat-${alert?.alertId ?? studentId}`}>
        <Select
          id={`alert-cat-${alert?.alertId ?? studentId}`}
          value={category}
          onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('text')}
        htmlFor={`alert-text-${alert?.alertId ?? studentId}`}
        hint={t('textHint')}
        error={save.fieldError('text')}
      >
        <Textarea
          id={`alert-text-${alert?.alertId ?? studentId}`}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          className="min-h-16"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={save.pending || !text.trim()}>
          {save.pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
