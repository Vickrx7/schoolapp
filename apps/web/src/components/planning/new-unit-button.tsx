'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { createUnit } from '@/server/actions/planning';
import type { SubjectOption } from '@/server/queries/subjects';

export function NewUnitButton({
  classId,
  subjects,
}: {
  classId: string;
  subjects: SubjectOption[];
}) {
  const t = useTranslations('units');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const create = useAction(createUnit, {
    successMessage: t('created'),
    onSuccess: ({ id }) => {
      setOpen(false);
      setTitle('');
      setDescription('');
      router.push(`/classes/${classId}/planning/${id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void create.run({ classId, subjectId, title, description }, makeActive);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('new')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('new')} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t('subject')} htmlFor="unit-subject" error={create.fieldError('subjectId')}>
            <Select
              id="unit-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">—</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('unitTitle')} htmlFor="unit-title" error={create.fieldError('title')}>
            <Input
              id="unit-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={`${t('description')} (${tCommon('optional')})`} htmlFor="unit-desc">
            <Textarea
              id="unit-desc"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={makeActive}
              onChange={(e) => setMakeActive(e.target.checked)}
            />
            {t('setActive')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={create.pending || !subjectId || !title.trim()}>
              {create.pending ? tCommon('saving') : t('create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
