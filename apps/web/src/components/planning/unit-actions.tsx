'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { deleteUnit, setUnitStatus, updateUnit } from '@/server/actions/planning';

export function UnitStatusButton({
  classId,
  unitId,
  status,
}: {
  classId: string;
  unitId: string;
  status: 'active' | 'completed';
}) {
  const t = useTranslations('units');
  const action = useAction(setUnitStatus, { successMessage: t('updated') });
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={action.pending}
      onClick={() => void action.run(classId, unitId, status)}
    >
      {status === 'active' ? t('setActive') : t('markCompleted')}
    </Button>
  );
}

export function EditUnitButton({
  classId,
  unitId,
  title: initialTitle,
  description: initialDescription,
}: {
  classId: string;
  unitId: string;
  title: string;
  description: string | null;
}) {
  const t = useTranslations('units');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  const update = useAction(updateUnit, {
    successMessage: t('updated'),
    onSuccess: () => setOpen(false),
  });
  const remove = useAction(deleteUnit, {
    successMessage: t('deleted'),
    onSuccess: () => router.push(`/classes/${classId}/planning`),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void update.run(classId, unitId, { title, description });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {tCommon('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent title={tCommon('edit')} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label={t('unitTitle')}
            htmlFor="edit-unit-title"
            error={update.fieldError('title')}
          >
            <Input
              id="edit-unit-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('description')} htmlFor="edit-unit-desc">
            <Textarea
              id="edit-unit-desc"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <ConfirmButton
              label={tCommon('delete')}
              message={t('deleteConfirm', { title: initialTitle })}
              confirmLabel={tCommon('delete')}
              variant="ghost"
              onConfirm={() => remove.run(classId, unitId)}
            />
            <Button type="submit" disabled={update.pending}>
              {update.pending ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
