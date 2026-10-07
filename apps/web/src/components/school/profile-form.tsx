'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { updateProfile } from '@/server/actions/profile';

export function ProfileForm({
  displayName,
  honorific,
}: {
  displayName: string;
  honorific: string;
}) {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(displayName);
  const [title, setTitle] = useState(honorific);
  const save = useAction(updateProfile, { successMessage: t('saved') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run({ displayName: name, honorific: title });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label={t('honorific')} htmlFor="profile-honorific">
          <Input
            id="profile-honorific"
            value={title}
            maxLength={20}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field
          label={t('displayName')}
          htmlFor="profile-name"
          error={save.fieldError('displayName')}
        >
          <Input
            id="profile-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-sm text-slate-500">{t('honorificHint')}</p>
      <Button type="submit" disabled={save.pending}>
        {save.pending ? tCommon('saving') : tCommon('save')}
      </Button>
    </form>
  );
}
