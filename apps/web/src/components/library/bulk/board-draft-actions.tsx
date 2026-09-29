'use client';

import { ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import { approveBoardDraft, deleteBoardDraft } from '@/server/actions/library-bulk';

export interface BoardDraftState {
  itemId: string;
  /** The revision on screen: approving anything newer is refused (`LXL07`). */
  revision: number;
  status: 'draft' | 'rejected' | 'teacher_reviewed';
  readyForApproval: boolean;
  /** Faith content: proposed, then its faith review comes first (D-064). */
  faithPending: boolean;
  /** From the bulk request: a title like an existing item's, a student's first name. */
  similarTitle: boolean;
  studentName: boolean;
}

/**
 * The board's draft on its page, for the board's content reviewers (DECISIONS D-091, D-095): what
 * to check, « Approuver pour le conseil » in one step (reviewed with the originality box, proposed,
 * approved; faith content stops after the proposal) and « Supprimer le brouillon ».
 */
export function BoardDraftActions({
  state,
  checklist,
}: {
  state: BoardDraftState;
  /** « Avant de proposer au conseil », shown while something is missing. */
  checklist: ReactNode;
}) {
  const t = useTranslations('libraryBulk');
  const tWorkflow = useTranslations('libraryEdit.workflow');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [originality, setOriginality] = useState(false);
  const approve = useAction(approveBoardDraft, {
    onSuccess: (outcome) => {
      toast.success(outcome === 'faith_review' ? t('faithFirst') : t('approved'));
      setOpen(false);
      router.refresh();
    },
  });
  const remove = useAction(deleteBoardDraft, {
    successMessage: t('deleted'),
    onSuccess: () => router.push('/library/review?queue=drafts'),
  });
  const deletable = state.status === 'draft' || state.status === 'rejected';

  return (
    <div className="space-y-3 rounded-lg border border-brand-100 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-900">{t('panel.title')}</h3>
      <p className="text-sm text-slate-700">{t('panel.hint')}</p>
      {state.similarTitle ? <Notice tone="warning">{t('panel.similarTitle')}</Notice> : null}
      {state.studentName ? <Notice tone="warning">{t('panel.studentName')}</Notice> : null}
      {state.readyForApproval ? null : checklist}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="success"
          disabled={!state.readyForApproval || approve.pending}
          aria-describedby={state.readyForApproval ? undefined : 'board-draft-not-ready'}
          onClick={() => {
            setOriginality(false);
            setOpen(true);
          }}
        >
          <ShieldCheck aria-hidden />
          {t('approveBoardDraft')}
        </Button>
        {deletable ? (
          <ConfirmButton
            label={t('deleteDraft')}
            message={t('deleteConfirm')}
            confirmLabel={t('deleteDraft')}
            variant="danger"
            size="md"
            onConfirm={() => remove.run(state.itemId)}
          >
            <Trash2 aria-hidden />
            {t('deleteDraft')}
          </ConfirmButton>
        ) : null}
      </div>
      {state.readyForApproval ? null : (
        <p id="board-draft-not-ready" className="text-sm text-slate-600">
          {t('panel.notReady')}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t('approveBoardDraft')}
          description={t('approveIntro')}
          closeLabel={tCommon('close')}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void approve.run(state.itemId, state.revision, originality);
            }}
          >
            {state.faithPending ? <Notice>{t('approveFaith')}</Notice> : null}
            <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0"
                checked={originality}
                onChange={(e) => setOriginality(e.target.checked)}
              />
              {tWorkflow('originality')}
            </label>
            {approve.error && approve.error !== 'invalid' ? (
              <p className="text-sm text-red-600" role="alert">
                {approve.errorText}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" variant="success" disabled={!originality || approve.pending}>
                {t('approveBoardDraft')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
