'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import {
  createPersonalLevel,
  deletePersonalLevel,
  updatePersonalLevel,
} from '@/server/actions/levels';
import type { LevelOption } from '@/server/queries/differentiate';

function PersonalLevel({ level }: { level: LevelOption }) {
  const t = useTranslations('levels');
  const tCommon = useTranslations('common');
  const [label, setLabel] = useState(level.label);
  const [description, setDescription] = useState(level.description ?? '');
  const [active, setActive] = useState(level.active);
  const save = useAction(updatePersonalLevel, { successMessage: t('updated') });
  const remove = useAction(deletePersonalLevel, { successMessage: t('deleted') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(level.id, { label, description, active });
  };

  return (
    <li className="py-3">
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('label')} htmlFor={`level-${level.id}`} error={save.fieldError('label')}>
          <Input
            id={`level-${level.id}`}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field
          label={t('description')}
          htmlFor={`level-desc-${level.id}`}
          error={save.fieldError('description')}
        >
          <Textarea
            id={`level-desc-${level.id}`}
            value={description}
            maxLength={1000}
            className="min-h-16"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t('active')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.pending}>
            {save.pending ? tCommon('saving') : tCommon('save')}
          </Button>
          <ConfirmButton
            label={tCommon('delete')}
            message={t('deleteConfirm')}
            confirmLabel={tCommon('delete')}
            variant="danger"
            onConfirm={() => remove.run(level.id)}
          />
        </div>
      </form>
    </li>
  );
}

export function LevelsManager({
  boardLevels,
  personalLevels,
  boards,
}: {
  boardLevels: LevelOption[];
  personalLevels: LevelOption[];
  boards: { id: string; name: string }[];
}) {
  const t = useTranslations('levels');
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const add = useAction(createPersonalLevel, {
    successMessage: t('added'),
    onSuccess: () => {
      setLabel('');
      setDescription('');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void add.run(boardId, { label, description });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('boardLevels')}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-2 text-sm text-slate-600">{t('boardLevelsHint')}</p>
          <ul className="divide-y divide-slate-100">
            {boardLevels.map((l) => (
              <li key={l.id} className="py-2">
                <p className="font-medium text-slate-900">{l.label}</p>
                <p className="text-sm text-slate-600">{l.description ?? t('noDescription')}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('myLevels')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">{t('myLevelsHint')}</p>
          {personalLevels.length === 0 ? (
            <p className="text-sm text-slate-500">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {personalLevels.map((l) => (
                <PersonalLevel key={l.id} level={l} />
              ))}
            </ul>
          )}
          <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
            {boards.length > 1 ? (
              <Select
                aria-label={t('boardLevels')}
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Field label={t('label')} htmlFor="new-level" error={add.fieldError('label')}>
              <Input
                id="new-level"
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field
              label={t('description')}
              htmlFor="new-level-desc"
              hint={t('descriptionHint')}
              error={add.fieldError('description')}
            >
              <Textarea
                id="new-level-desc"
                value={description}
                maxLength={1000}
                className="min-h-16"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={add.pending}>
              {t('add')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
