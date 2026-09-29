import { reviewReadiness } from '@lynx/content';
import { getTranslations } from 'next-intl/server';
import type { LibraryItemView } from '@/server/library/view-model';
import { loadItemKeys } from '@/server/queries/library';
import { loadBoardLevelIds } from '@/server/queries/library-authoring';
import { loadBoardDraftFlags } from '@/server/queries/library-bulk';
import { loadLineage } from '@/server/queries/library-growth';
import { getSession, librarySchools } from '@/server/session';
import { BoardDraftActions } from '../bulk/board-draft-actions';
import { lineageText } from '../growth/lineage';
import { ReadinessChecklist } from '../readiness-checklist';
import { ReviewPanel } from '../review-panel';
import { WorkflowActions } from '../workflow-actions';

/**
 * The item page's workflow panel (slice S6, DECISIONS D-063 to D-067): for the item's keeper
 * (its author, or a content reviewer for the board's own items) the readiness checklist
 * « Avant de marquer comme révisée » (then « Avant de proposer au conseil ») and the workflow
 * buttons; for the board's reviewers the « Décision » panel. Readiness is computed here from what
 * the page shows, with the same rules as the database (`reviewReadiness`, D-067); the database
 * checks again on every step. Rendered on the server under the header.
 */
export async function WorkflowSlot({ item }: { item: LibraryItemView }) {
  const session = await getSession();
  if (!session) return null;
  const keeper = item.mine || (item.boardOwn && item.reviewerKinds.includes('content'));
  const reviewer = item.reviewerKinds.length > 0;
  if (!keeper && !reviewer) return null;

  // The board's own draft, not yet proposed (bulk generation D-095, or a content pack's resource
  // that was not ready, D-100): « Approuver pour le conseil » in one step and « Supprimer le
  // brouillon », for its content reviewers.
  const boardDraft =
    item.boardOwn &&
    (item.status === 'draft' ||
      item.status === 'rejected' ||
      (item.status === 'teacher_reviewed' && !item.requested));
  const [t, tGrowth, keys, boardLevelIds, lineage, draftFlags] = await Promise.all([
    getTranslations('libraryEdit.workflow'),
    getTranslations('libraryGrowth'),
    loadItemKeys(
      item.id,
      item.versions.map((v) => v.id),
    ),
    loadBoardLevelIds(item.boardId),
    // An adaptation's credit, shown when its author shares it (D-092).
    item.mine && item.status === 'teacher_reviewed' && item.adaptation.isAdaptation
      ? loadLineage(item.id)
      : Promise.resolve(null),
    boardDraft ? loadBoardDraftFlags(item.id) : Promise.resolve(null),
  ]);
  const input = {
    item: {
      type: item.type,
      gradeCodes: item.grades.map((g) => g.code),
      subjectId: item.subject?.id ?? null,
      durationMinutes: item.durationMinutes,
      materials: item.materials,
      keywords: item.keywords,
      tagIds: item.tags.map((tag) => tag.id),
      expectationIds: item.expectations.map((e) => e.id),
      safetyNotes: item.safetyNotes,
      subFriendly: item.subFriendly,
    },
    versions: item.versions.map((v) => ({
      languageLevelId: v.languageLevelId,
      content: v.content,
      answerKey: keys.get(v.id) ?? null,
    })),
    boardLevelIds,
  };
  const forReview = reviewReadiness({ ...input, forApproval: false });
  const forApproval = reviewReadiness({ ...input, forApproval: true });
  const draftLike = item.status === 'draft' || item.status === 'rejected';
  const showKeeper = keeper && (item.canEdit || item.status === 'archived' || item.mine);

  return (
    <div className="space-y-4 print:hidden">
      {showKeeper ? (
        <section
          aria-labelledby="workflow-panel"
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="workflow-panel" className="text-base font-semibold text-slate-900">
            {t('title')}
          </h2>
          {draftLike && item.canEdit ? (
            <ReadinessChecklist type={item.type} readiness={forReview} forApproval={false} />
          ) : null}
          {item.status === 'teacher_reviewed' && item.canEdit && !item.requested ? (
            <ReadinessChecklist type={item.type} readiness={forApproval} forApproval />
          ) : null}
          <WorkflowActions
            state={{
              itemId: item.id,
              status: item.status,
              shareScope: item.shareScope,
              requested: item.requested,
              mine: item.mine,
              keeper,
              canEdit: item.canEdit,
              schoolId: item.schoolId,
              schools: librarySchools(session)
                .filter((s) => s.boardId === item.boardId)
                .map((s) => ({ id: s.id, name: s.name })),
              faithBlocksBoard: item.faith.requiresReview && !item.faith.reviewed,
              personalLevels: item.versions.some((v) => v.personalLevel),
              readyForReview: forReview.ready,
              readyForApproval: forApproval.ready,
              shareCapSchoolId: item.adaptation.shareCapSchoolId,
              credit: lineage
                ? lineageText((key, values) => tGrowth(key, values as never), lineage)
                : null,
            }}
          />
        </section>
      ) : null}
      {reviewer ? (
        <ReviewPanel
          state={{
            itemId: item.id,
            userId: session.userId,
            revision: item.contentRevision,
            status: item.status,
            shareScope: item.shareScope,
            requested: item.requested,
            mine: item.mine,
            boardOwn: item.boardOwn,
            kinds: item.reviewerKinds,
            requiresFaithReview: item.faith.requiresReview,
            faithReviewed: item.faith.reviewed,
            faithContent: item.faith.content,
            readyForApproval: forApproval.ready,
          }}
          checklist={<ReadinessChecklist type={item.type} readiness={forApproval} forApproval />}
          boardDraft={
            boardDraft ? (
              <BoardDraftActions
                state={{
                  itemId: item.id,
                  revision: item.contentRevision,
                  status: item.status as 'draft' | 'rejected' | 'teacher_reviewed',
                  readyForApproval: forApproval.ready,
                  faithPending: item.faith.requiresReview && !item.faith.reviewed,
                  similarTitle: draftFlags?.similarTitle ?? false,
                  studentName: draftFlags?.studentName ?? false,
                }}
                checklist={
                  <ReadinessChecklist type={item.type} readiness={forApproval} forApproval />
                }
              />
            ) : null
          }
        />
      ) : null}
    </div>
  );
}
