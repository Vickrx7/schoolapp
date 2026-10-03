'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { setLibraryReviewer } from '@/server/actions/board';

export interface Reviewer {
  roleId: string;
  userId: string;
  displayName: string;
  approvesContent: boolean;
  reviewsFaith: boolean;
}

function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** One designated person: each box saves at once; unchecking both removes the designation. */
function ReviewerRow({ reviewer }: { reviewer: Reviewer }) {
  const t = useTranslations('board.reviewers');
  const [approves, setApproves] = useState(reviewer.approvesContent);
  const [faith, setFaith] = useState(reviewer.reviewsFaith);
  const save = useAction(setLibraryReviewer, { successMessage: t('saved') });
  const remove = useAction(setLibraryReviewer, { successMessage: t('removed') });

  const change = async (next: { approvesContent: boolean; reviewsFaith: boolean }) => {
    const before = { approves, faith };
    setApproves(next.approvesContent);
    setFaith(next.reviewsFaith);
    const result = await (next.approvesContent || next.reviewsFaith ? save : remove).run(
      reviewer.roleId,
      next,
    );
    // Not saved: the boxes show what is saved.
    if (!result?.ok) {
      setApproves(before.approves);
      setFaith(before.faith);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <fieldset className="min-w-0">
        <legend className="font-medium text-slate-900">{reviewer.displayName}</legend>
        <div className="flex flex-wrap gap-x-6">
          <Checkbox
            label={t('approvesContent')}
            checked={approves}
            disabled={save.pending || remove.pending}
            onChange={(v) => void change({ approvesContent: v, reviewsFaith: faith })}
          />
          <Checkbox
            label={t('reviewsFaith')}
            checked={faith}
            disabled={save.pending || remove.pending}
            onChange={(v) => void change({ approvesContent: approves, reviewsFaith: v })}
          />
        </div>
      </fieldset>
      <ConfirmButton
        label={t('removeLabel', { name: reviewer.displayName })}
        message={t('removeConfirm', { name: reviewer.displayName })}
        confirmLabel={t('remove')}
        size="md"
        onConfirm={() =>
          remove.run(reviewer.roleId, { approvesContent: false, reviewsFaith: false })
        }
      >
        {t('remove')}
      </ConfirmButton>
    </Card>
  );
}

/**
 * « Approbation des ressources » (DECISIONS D-064, D-107): who approves resources proposed to the
 * whole board and who reviews faith content. « Désigner une personne » picks from the board's
 * active staff.
 */
export function ReviewersEditor({
  reviewers,
  candidates,
}: {
  reviewers: Reviewer[];
  candidates: { roleId: string; displayName: string }[];
}) {
  const t = useTranslations('board.reviewers');
  const [roleId, setRoleId] = useState('');
  const [approves, setApproves] = useState(true);
  const [faith, setFaith] = useState(false);
  const [pickOne, setPickOne] = useState(false);
  const designate = useAction(setLibraryReviewer, {
    successMessage: t('saved'),
    onSuccess: () => {
      setRoleId('');
      setApproves(true);
      setFaith(false);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPickOne(!approves && !faith);
    if (!roleId || (!approves && !faith)) return;
    void designate.run(roleId, { approvesContent: approves, reviewsFaith: faith });
  };

  return (
    <div className="space-y-4">
      {reviewers.length === 0 ? (
        <Notice tone="warning">{t('empty')}</Notice>
      ) : (
        <ul className="space-y-2">
          {reviewers.map((r) => (
            <li key={r.userId}>
              <ReviewerRow reviewer={r} />
            </li>
          ))}
        </ul>
      )}
      <Card className="p-4">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <h2 className="font-semibold text-slate-900">{t('designate')}</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-600">{t('nobodyLeft')}</p>
          ) : (
            <>
              <Field label={t('person')} htmlFor="reviewer-person">
                <Select
                  id="reviewer-person"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  <option value="">{t('choosePerson')}</option>
                  {candidates.map((c) => (
                    <option key={c.roleId} value={c.roleId}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-x-6">
                <Checkbox label={t('approvesContent')} checked={approves} onChange={setApproves} />
                <Checkbox label={t('reviewsFaith')} checked={faith} onChange={setFaith} />
              </div>
              {pickOne ? (
                <p className="text-sm text-red-600" role="alert">
                  {t('pickOne')}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" disabled={!roleId || designate.pending}>
                  {t('designateSubmit')}
                </Button>
              </div>
            </>
          )}
        </form>
      </Card>
    </div>
  );
}
