'use client';

import type { LibraryItemStatus, ShareScope } from '@lynx/db';
import { Flag, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { decideFaith, decideItem, flagFaith, retractItem } from '@/server/actions/library-review';
import type { ReviewerKind } from '@/server/library/view-model';
import { RejectDialog } from './reject-dialog';

export interface ReviewState {
  itemId: string;
  userId: string;
  /** The revision on screen: a decision on anything newer is refused (`LXL07`). */
  revision: number;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  requested: boolean;
  /** The reviewer wrote it: never approved or sent back by them (D-064). */
  mine: boolean;
  /** The board's own item (no author): content reviewers keep reading it after a decision. */
  boardOwn: boolean;
  kinds: ReviewerKind[];
  requiresFaithReview: boolean;
  faithReviewed: boolean;
  faithContent: boolean;
  readyForApproval: boolean;
}

/**
 * « Décision » for the board's designated reviewers (DECISIONS D-064): the approval checklist,
 * « Approuver pour le conseil » (after the faith review, never on one's own resource, refused if
 * the author changed it meanwhile), « Renvoyer pour révision » with a note, and for faith
 * reviewers « Contenu de foi conforme ». Any reviewer may « Signaler du contenu de foi »; content
 * reviewers may « Retirer de la banque » a shared or approved resource.
 */
export function ReviewPanel({ state, checklist }: { state: ReviewState; checklist: ReactNode }) {
  const t = useTranslations('libraryReview.decision');
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  // Sending back or withdrawing makes a teacher's item private again: the reviewer can no longer
  // open it, so she goes back to the queue. The board's own items stay open to content reviewers.
  const afterDecision = (by: ReviewerKind) => () => {
    if (state.mine || (state.boardOwn && by === 'content')) router.refresh();
    else router.push('/library/review');
  };
  const approve = useAction(decideItem, { successMessage: t('approved'), ...refresh });
  const faithOk = useAction(decideFaith, { successMessage: t('faithApproved'), ...refresh });
  const flag = useAction(flagFaith, { successMessage: t('flagged'), ...refresh });
  const content = state.kinds.includes('content');
  const faith = state.kinds.includes('faith');
  const awaiting = state.requested && state.status === 'teacher_reviewed';
  const faithPending = state.requiresFaithReview && !state.faithReviewed;
  const canFlag =
    !state.faithContent && state.status !== 'board_approved' && state.status !== 'archived';
  const canRetract =
    content &&
    (state.status === 'teacher_reviewed' || state.status === 'board_approved') &&
    state.shareScope !== 'private';
  const decides = awaiting && (content || (faith && faithPending));
  if (!decides && !canFlag && !canRetract) return null;

  const approveBlocked = state.mine
    ? t('ownItem')
    : faithPending
      ? t('faithPending')
      : !state.readyForApproval
        ? t('notReady')
        : null;

  return (
    <section
      aria-labelledby="review-panel"
      className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4"
    >
      <h2 id="review-panel" className="text-base font-semibold text-slate-900">
        {t('title')}
      </h2>
      {decides ? checklist : null}

      {awaiting && content ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="success"
              disabled={approveBlocked !== null || approve.pending}
              aria-describedby={approveBlocked ? 'review-approve-blocked' : undefined}
              onClick={() => void approve.run(state.itemId, 'approve', '', state.revision)}
            >
              <ShieldCheck aria-hidden />
              {t('approve')}
            </Button>
            {state.mine ? null : (
              <RejectDialog
                userId={state.userId}
                itemId={state.itemId}
                kind="reject"
                label={t('reject')}
                title={t('reject')}
                intro={t('rejectIntro')}
                submitLabel={t('reject')}
                successMessage={t('rejected')}
                onDone={afterDecision('content')}
                onSubmit={(note) => decideItem(state.itemId, 'reject', note, state.revision)}
              />
            )}
          </div>
          {approveBlocked ? (
            <p id="review-approve-blocked" className="text-sm text-slate-700">
              {approveBlocked}
            </p>
          ) : null}
          {state.mine ? <p className="text-sm text-slate-700">{t('ownItemHint')}</p> : null}
        </div>
      ) : null}

      {awaiting && faith && state.requiresFaithReview ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t('faithTitle')}</h3>
          {state.faithReviewed ? (
            <p className="text-sm text-slate-700">{t('faithDone')}</p>
          ) : state.mine ? (
            <p className="text-sm text-slate-700">{t('ownItem')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="success"
                disabled={faithOk.pending}
                onClick={() => void faithOk.run(state.itemId, 'approve', '', state.revision)}
              >
                {t('faithApprove')}
              </Button>
              <RejectDialog
                userId={state.userId}
                itemId={state.itemId}
                kind="faith"
                label={t('reject')}
                title={t('faithReject')}
                intro={t('faithRejectIntro')}
                submitLabel={t('reject')}
                successMessage={t('rejected')}
                onDone={afterDecision('faith')}
                onSubmit={(note) => decideFaith(state.itemId, 'reject', note, state.revision)}
              />
            </div>
          )}
        </div>
      ) : null}

      {canFlag || canRetract ? (
        <div className="flex flex-wrap gap-2 border-t border-brand-100 pt-3">
          {canFlag ? (
            <ConfirmButton
              label={t('flag')}
              message={t('flagConfirm')}
              confirmLabel={t('flag')}
              tone="primary"
              size="md"
              onConfirm={() => flag.run(state.itemId)}
            >
              <Flag aria-hidden />
              {t('flag')}
            </ConfirmButton>
          ) : null}
          {canRetract ? (
            <RejectDialog
              userId={state.userId}
              itemId={state.itemId}
              kind="retract"
              label={t('retract')}
              title={t('retract')}
              intro={t('retractIntro')}
              submitLabel={t('retract')}
              successMessage={t('retracted')}
              onDone={afterDecision('content')}
              variant="danger"
              onSubmit={(note) => retractItem(state.itemId, note)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
