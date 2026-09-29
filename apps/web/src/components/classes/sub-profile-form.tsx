'use client';

import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { saveClassSubProfile } from '@/server/actions/sub-profile';
import type { ClassSubProfile } from '@/server/queries/sub-profile';

const TEXT_FIELDS = [
  ['arrivalNotes', 'arrival'],
  ['routinesNotes', 'routines'],
  ['classroomManagementNotes', 'classManagement'],
  ['dismissalNotes', 'dismissal'],
  ['fallbackActivities', 'fallbackActivities'],
] as const;

/**
 * « Fiche de suppléance »: what never changes from one absence to the next (arrival, routines,
 * class management, dismissal, backup activities, the colleague next door). Every plan of the
 * class draws on it. Kept on the device until saved (D-035).
 */
export function SubProfileForm({
  userId,
  classId,
  profile,
  colleagues,
}: {
  userId: string;
  classId: string;
  profile: ClassSubProfile;
  colleagues: { id: string; name: string }[];
}) {
  const t = useTranslations('subProfile');
  const tCommon = useTranslations('common');
  const tPlan = useTranslations('subPlan');
  const initial = useMemo(
    () => ({
      arrivalNotes: profile.arrivalNotes ?? '',
      routinesNotes: profile.routinesNotes ?? '',
      classroomManagementNotes: profile.classroomManagementNotes ?? '',
      dismissalNotes: profile.dismissalNotes ?? '',
      fallbackActivities: profile.fallbackActivities ?? '',
      neighbourTeacherId: colleagues.some((c) => c.id === profile.neighbourTeacherId)
        ? (profile.neighbourTeacherId ?? '')
        : '',
      neighbourNote: profile.neighbourNote ?? '',
    }),
    [profile, colleagues],
  );
  const draft = useDraft(`sub-profile:${userId}:${classId}`, initial, {
    version: profile.updatedAt ?? 'new',
  });
  const v = draft.value;
  const save = useAction(saveClassSubProfile, {
    successMessage: t('saved'),
    onSuccess: () => draft.clear(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run({ classId, ...v, neighbourTeacherId: v.neighbourTeacherId || null });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">{t('intro')}</p>
          <Notice tone="warning" className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('hint')}</span>
          </Notice>
          {draft.restored ? (
            <Notice className="flex flex-wrap items-center justify-between gap-2">
              <span>{tCommon('draftRestored')}</span>
              <Button variant="ghost" size="sm" onClick={draft.discard}>
                {tCommon('discardDraft')}
              </Button>
            </Notice>
          ) : null}
          {draft.offered ? (
            <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
              <span>{tPlan('draftOffered')}</span>
              <Button variant="secondary" size="sm" onClick={draft.recover}>
                {tPlan('draftRecover')}
              </Button>
            </Notice>
          ) : null}
          {TEXT_FIELDS.map(([field, label]) => (
            <Field
              key={field}
              label={`${t(`fields.${label}`)} (${tCommon('optional')})`}
              htmlFor={`sub-profile-${field}`}
              hint={t(`fields.${label}Hint`)}
              error={save.fieldError(field)}
            >
              <Textarea
                id={`sub-profile-${field}`}
                value={v[field]}
                maxLength={2000}
                className="min-h-20"
                onChange={(e) => draft.update(field, e.target.value)}
              />
            </Field>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fields.neighbour')}
              htmlFor="sub-profile-neighbour"
              error={save.fieldError('neighbourTeacherId')}
            >
              <Select
                id="sub-profile-neighbour"
                value={v.neighbourTeacherId}
                onChange={(e) => draft.update('neighbourTeacherId', e.target.value)}
              >
                <option value="">{t('fields.neighbourNone')}</option>
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`${t('fields.neighbourNote')} (${tCommon('optional')})`}
              htmlFor="sub-profile-neighbour-note"
              hint={t('fields.neighbourNoteHint')}
              error={save.fieldError('neighbourNote')}
            >
              <Input
                id="sub-profile-neighbour-note"
                value={v.neighbourNote}
                maxLength={200}
                onChange={(e) => draft.update('neighbourNote', e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={save.pending}>
              {save.pending ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
