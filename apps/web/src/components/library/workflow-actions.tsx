'use client';

import type { LibraryItemStatus, ShareScope } from '@lynx/db';
import { Archive, CheckCircle2, RotateCcw, Send, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction, useErrorText } from '@/hooks/use-action';
import {
  archiveItem,
  cancelApproval,
  deleteLibraryItem,
  markReviewed,
  requestApproval,
  restoreItem,
  returnToDraft,
} from '@/server/actions/library';
import { NamesDialog, type NamesCheckState } from './names-dialog';
import { ShareDialog } from './share-dialog';

export interface WorkflowState {
  itemId: string;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  requested: boolean;
  /** The user wrote it (sharing and deleting are the author's). */
  mine: boolean;
  /** The author, or a content reviewer for the board's own items. */
  keeper: boolean;
  canEdit: boolean;
  schoolId: string | null;
  schools: { id: string; name: string }[];
  /** Faith content without its faith review: not with the whole board yet (D-064). */
  faithBlocksBoard: boolean;
  /** Versions for the author's personal levels keep it private (D-066). */
  personalLevels: boolean;
  /** « Avant de marquer comme révisée » is complete. */
  readyForReview: boolean;
  /** « Avant de proposer au conseil » is complete. */
  readyForApproval: boolean;
}

/**
 * The author's workflow on the item page (DECISIONS D-063, D-066, D-067): « J'ai révisé cette
 * ressource » (with the originality confirmation), « Partager », « Proposer au conseil » /
 * « Retirer la demande », « Remettre en brouillon », « Archiver » / « Restaurer » and
 * « Supprimer ». What is offered follows the status; the database checks each step again.
 */
export function WorkflowActions({ state }: { state: WorkflowState }) {
  const t = useTranslations('libraryEdit.workflow');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const router = useRouter();
  const done = (message: string) => ({
    successMessage: message,
    onSuccess: () => router.refresh(),
  });
  const review = useAction(markReviewed, done(t('reviewedDone')));
  const back = useAction(returnToDraft, done(t('draftDone')));
  const request = useAction(requestApproval);
  const cancel = useAction(cancelApproval, done(t('cancelDone')));
  const archive = useAction(archiveItem, done(t('archiveDone')));
  const restore = useAction(restoreItem, done(t('restoreDone')));
  const remove = useAction(deleteLibraryItem, {
    successMessage: t('deleteDone'),
    onSuccess: () => router.push('/library/mine'),
  });
  const [confirming, setConfirming] = useState(false);
  const [originality, setOriginality] = useState(false);
  const [names, setNames] = useState<NamesCheckState | null>(null);
  const { itemId, status } = state;
  const draftLike = status === 'draft' || status === 'rejected';

  const propose = async (confirmed: string[]) => {
    const result = await request.run(itemId, confirmed);
    if (result && !result.ok && result.fieldErrors) toast.error(errorText(result.error));
    if (!result?.ok) return;
    if (!result.data.done) {
      setNames({ names: result.data.names, blocked: result.data.blocked });
      return;
    }
    setNames(null);
    toast.success(t('requestDone'));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {draftLike && state.canEdit ? (
          // Not disabled when something is missing: the refusal names it (D-067), and the
          // checklist above says what to complete.
          <Button
            onClick={() => setConfirming(true)}
            aria-describedby={state.readyForReview ? undefined : 'workflow-not-ready'}
          >
            <CheckCircle2 aria-hidden />
            {t('markReviewed')}
          </Button>
        ) : null}

        {status === 'teacher_reviewed' && state.mine ? (
          <ShareDialog
            itemId={itemId}
            current={state.shareScope}
            schoolId={state.schoolId}
            schools={state.schools}
            faithBlocksBoard={state.faithBlocksBoard}
            personalLevels={state.personalLevels}
          />
        ) : null}

        {status === 'teacher_reviewed' && state.canEdit && !state.requested ? (
          <Button
            variant="secondary"
            disabled={!state.readyForApproval || state.personalLevels || request.pending}
            aria-describedby={
              state.readyForApproval && !state.personalLevels ? undefined : 'workflow-approval-hint'
            }
            onClick={() => void propose([])}
          >
            <Send aria-hidden />
            {t('request')}
          </Button>
        ) : null}
        {state.requested && state.canEdit ? (
          <Button
            variant="secondary"
            disabled={cancel.pending}
            onClick={() => void cancel.run(itemId)}
          >
            <Undo2 aria-hidden />
            {t('cancelRequest')}
          </Button>
        ) : null}

        {status === 'teacher_reviewed' && state.canEdit ? (
          <ConfirmButton
            label={t('toDraft')}
            message={t('toDraftConfirm')}
            confirmLabel={t('toDraft')}
            tone="primary"
            size="md"
            onConfirm={() => back.run(itemId)}
          />
        ) : null}

        {status !== 'archived' && state.keeper ? (
          <ConfirmButton
            label={t('archive')}
            message={
              status === 'board_approved' ? t('archiveApprovedConfirm') : t('archiveConfirm')
            }
            confirmLabel={t('archive')}
            tone="primary"
            size="md"
            onConfirm={() => archive.run(itemId)}
          >
            <Archive aria-hidden />
            {t('archive')}
          </ConfirmButton>
        ) : null}
        {status === 'archived' && state.keeper ? (
          <Button
            variant="secondary"
            disabled={restore.pending}
            onClick={() => void restore.run(itemId)}
          >
            <RotateCcw aria-hidden />
            {t('restore')}
          </Button>
        ) : null}

        {state.mine && (draftLike || status === 'archived') ? (
          <ConfirmButton
            label={t('delete')}
            message={t('deleteConfirm')}
            confirmLabel={tCommon('delete')}
            variant="danger"
            size="md"
            onConfirm={() => remove.run(itemId)}
          />
        ) : null}
      </div>

      {draftLike && state.canEdit && !state.readyForReview ? (
        <p id="workflow-not-ready" className="text-sm text-slate-600">
          {t('notReadyHint')}
        </p>
      ) : null}
      {status === 'teacher_reviewed' && state.canEdit && !state.requested ? (
        state.personalLevels ? (
          <p id="workflow-approval-hint" className="text-sm text-slate-600">
            {t('personalLevelsHint')}
          </p>
        ) : !state.readyForApproval ? (
          <p id="workflow-approval-hint" className="text-sm text-slate-600">
            {t('approvalHint')}
          </p>
        ) : null
      ) : null}
      {status === 'teacher_reviewed' && state.mine && state.faithBlocksBoard ? (
        <p className="text-sm text-slate-600">{t('faithBoardHint')}</p>
      ) : null}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={t('markReviewed')}
          description={t('markReviewedIntro')}
          closeLabel={tCommon('close')}
        >
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await review.run(itemId, originality);
              if (result?.ok) setConfirming(false);
            }}
          >
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0"
                checked={originality}
                onChange={(e) => setOriginality(e.target.checked)}
              />
              {t('originality')}
            </label>
            {review.fieldError('originality') ? (
              <p className="text-sm text-red-600" role="alert">
                {review.fieldError('originality')}
              </p>
            ) : null}
            {review.error && review.error !== 'invalid' ? (
              <p className="text-sm text-red-600" role="alert">
                {review.errorText}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={!originality || review.pending}>
                {t('markReviewedSubmit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <NamesDialog
        state={names}
        pending={request.pending}
        onClose={() => setNames(null)}
        onConfirm={(confirmed) => void propose(confirmed)}
        confirmLabel={t('request')}
      />
    </div>
  );
}
