import 'server-only';
import { TYPE_INFO, isLibraryItemType } from '@lynx/content';
import { formalStaffName } from '@lynx/domain';
import { cache } from 'react';
import { localized } from '@/i18n/config';
import {
  libraryAccess,
  versionOrder,
  type LibraryItemView,
  type LibraryVersionView,
} from '../library/view-model';
import type { SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * The library's item page and print page (DECISIONS D-062, D-065, D-075). Everything is read
 * as the user: row level security decides what is readable (`app.library_item_readable_by`),
 * and an item the user cannot read is simply not found. Answer keys are read by `loadItemKeys`
 * only, for staff views; the student sheet's loader never touches the key table.
 */

const ITEM_COLUMNS = `id, board_id, school_id, type, bucket, title, summary, status, share_scope, source,
  author_id, licence, subject_id, duration_minutes, materials, keywords, is_printable,
  is_projectable, is_interactive, sub_friendly, safety_notes, catholic_connection,
  catholic_reference_id, faith_content, faith_flagged_by, faith_on_student_sheet,
  requires_faith_review, prompt_version, model, usage_count, content_revision,
  review_requested_at, approved_at, faith_reviewed_at, review_note, created_at, updated_at,
  board_owned, parent_item_id, parent_title, share_cap_school_id, no_derivatives,
  subjects(id, code, label_fr, label_en),
  schools(name),
  catholic_references(title),
  content_packs(title, version),
  ai_generations(feature),
  author:users!library_items_author_id_fkey(display_name, honorific)`;

/** The order of attentes: by grade, overall before specific, then as the curriculum lists them. */
const byCurriculum = (
  a: { grade_code: string; kind: string; sort_order: number; code: string },
  b: { grade_code: string; kind: string; sort_order: number; code: string },
) =>
  a.grade_code.localeCompare(b.grade_code, 'fr-CA', { numeric: true }) ||
  Number(a.kind !== 'overall') - Number(b.kind !== 'overall') ||
  a.sort_order - b.sort_order ||
  a.code.localeCompare(b.code, 'fr-CA', { numeric: true });

/**
 * Everything the item page shows (« Fiche de la ressource »), or null when the user cannot read
 * the item. Level labels are the user's (a colleague's personal level is unreadable and shows
 * as « Autre niveau »); the review state and the reviewer's note only reach the item's keeper
 * and the board's reviewers. Cached per request (the page and its metadata both ask).
 */
export const loadLibraryItem = cache(
  async (
    itemId: string,
    session: SessionContext,
    locale: string,
  ): Promise<LibraryItemView | null> => {
    const supabase = await createSupabaseServerClient();
    const [item, versions, keys, grades, expectations, tags] = await Promise.all([
      supabase.from('library_items').select(ITEM_COLUMNS).eq('id', itemId).maybeSingle(),
      supabase
        .from('library_item_versions')
        .select(
          'id, language_level_id, schema_version, content, language_levels(label_fr, label_en, sort_order, owner_user_id)',
        )
        .eq('item_id', itemId),
      supabase
        .from('library_item_answer_keys')
        .select('version_id, library_item_versions!inner(item_id)')
        .eq('library_item_versions.item_id', itemId),
      supabase
        .from('library_item_grades')
        .select('grade_code, grades(label_fr, label_en, ordinal)')
        .eq('item_id', itemId),
      supabase
        .from('library_item_expectations')
        .select(
          'curriculum_expectations(id, code, text_fr, text_en, is_verified, kind, grade_code, sort_order)',
        )
        .eq('item_id', itemId),
      supabase.from('library_item_tags').select('tags(id, label_fr)').eq('item_id', itemId),
    ]);
    const row = item.data;
    if (!row || !isLibraryItemType(row.type)) return null;

    const access = libraryAccess(
      {
        boardId: row.board_id,
        authorId: row.author_id,
        boardOwned: row.board_owned,
        status: row.status,
      },
      session.userId,
      session.libraryReviewer,
    );
    const withKey = new Set((keys.data ?? []).map((k) => k.version_id));
    const ordered = versionOrder(
      (versions.data ?? []).map((v) => ({
        id: v.id,
        languageLevelId: v.language_level_id,
        level: v.language_levels
          ? {
              sortOrder: v.language_levels.sort_order,
              personal: v.language_levels.owner_user_id !== null,
            }
          : null,
        raw: v,
      })),
    );
    const versionViews: LibraryVersionView[] = ordered.map(({ raw, number }) => ({
      id: raw.id,
      languageLevelId: raw.language_level_id,
      levelLabel: raw.language_levels
        ? localized(locale, raw.language_levels.label_fr, raw.language_levels.label_en)
        : null,
      personalLevel: raw.language_levels?.owner_user_id != null,
      number,
      schemaVersion: raw.schema_version,
      content: raw.content,
      hasKey: withKey.has(raw.id),
    }));

    const author = row.author;
    return {
      id: row.id,
      boardId: row.board_id,
      schoolId: row.school_id,
      schoolName: row.schools?.name ?? null,
      type: row.type,
      bucket: row.bucket ?? TYPE_INFO[row.type].bucket,
      title: row.title,
      summary: row.summary,
      status: row.status,
      shareScope: row.share_scope,
      source: row.source,
      requested: row.review_requested_at !== null,
      mine: access.mine,
      boardOwn: row.board_owned,
      authorName: author ? formalStaffName(author.display_name, author.honorific) : null,
      subject: row.subjects
        ? {
            id: row.subjects.id,
            code: row.subjects.code,
            label: localized(locale, row.subjects.label_fr, row.subjects.label_en),
            labelFr: row.subjects.label_fr,
          }
        : null,
      grades: (grades.data ?? [])
        .filter((g) => g.grades !== null)
        .sort((a, b) => (a.grades?.ordinal ?? 0) - (b.grades?.ordinal ?? 0))
        .map((g) => ({
          code: g.grade_code,
          label: localized(locale, g.grades!.label_fr, g.grades!.label_en),
          labelFr: g.grades!.label_fr,
        })),
      expectations: (expectations.data ?? [])
        .map((e) => e.curriculum_expectations)
        .filter((e) => e !== null)
        .sort(byCurriculum)
        .map((e) => ({
          id: e.id,
          code: e.code,
          text: localized(locale, e.text_fr, e.text_en),
          textFr: e.text_fr,
          verified: e.is_verified,
          kind: e.kind,
        })),
      tags: (tags.data ?? [])
        .map((t) => t.tags)
        .filter((t) => t !== null)
        .map((t) => ({ id: t.id, label: t.label_fr }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr-CA')),
      keywords: row.keywords,
      durationMinutes: row.duration_minutes,
      materials: row.materials,
      licence: row.licence,
      formats: {
        printable: row.is_printable,
        projectable: row.is_projectable,
        interactive: row.is_interactive,
      },
      subFriendly: row.sub_friendly,
      safetyNotes: row.safety_notes,
      faith: {
        content: row.faith_content,
        connection: row.catholic_connection,
        referenceId: row.catholic_reference_id,
        referenceTitle: row.catholic_references?.title ?? null,
        onStudentSheet: row.faith_on_student_sheet,
        requiresReview: row.requires_faith_review,
        reviewed: row.faith_reviewed_at !== null,
      },
      provenance: {
        aiFeature: row.ai_generations?.feature ?? null,
        promptVersion: row.prompt_version,
        model: row.model,
        packTitle: row.content_packs?.title ?? null,
        packVersion: row.content_packs?.version ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        approvedAt: row.approved_at,
        usageCount: row.usage_count,
      },
      contentRevision: row.content_revision,
      canEdit: access.canEdit,
      reviewerKinds: access.reviewerKinds,
      review:
        access.keeper || access.reviewerKinds.length > 0
          ? {
              requestedAt: row.review_requested_at,
              note: row.review_note,
              faithReviewedAt: row.faith_reviewed_at,
              faithFlagged: row.faith_flagged_by !== null,
            }
          : null,
      versions: versionViews,
      hasKeys: versionViews.some((v) => v.hasKey),
      adaptation: {
        isAdaptation: row.parent_item_id !== null || row.parent_title !== null,
        shareCapSchoolId: row.share_cap_school_id,
        noDerivatives: row.no_derivatives,
      },
    };
  },
);

export interface StudentSheetSource {
  id: string;
  type: LibraryItemView['type'];
  title: string;
  /** Printed for students only when the author chose so, or for a Catholic reflection. */
  faith: { connection: string | null; onStudentSheet: boolean };
  /** The chosen versions (all of them when none is chosen), in version order. */
  versions: { id: string; number: number; schemaVersion: number; content: unknown }[];
}

/**
 * What a student sheet is printed from (D-062): the versions' content and the item's type,
 * title and faith link, and nothing else. It never reads the answer keys, and it never reads
 * level names either (only their order, for the small printed number).
 */
export async function loadItemForStudentSheet(
  itemId: string,
  versionIds: readonly string[],
): Promise<StudentSheetSource | null> {
  const supabase = await createSupabaseServerClient();
  const [item, versions] = await Promise.all([
    supabase
      .from('library_items')
      .select('id, type, title, catholic_connection, faith_on_student_sheet')
      .eq('id', itemId)
      .maybeSingle(),
    supabase
      .from('library_item_versions')
      .select(
        'id, language_level_id, schema_version, content, language_levels(sort_order, owner_user_id)',
      )
      .eq('item_id', itemId),
  ]);
  if (!item.data || !isLibraryItemType(item.data.type)) return null;
  const ordered = versionOrder(
    (versions.data ?? []).map((v) => ({
      id: v.id,
      languageLevelId: v.language_level_id,
      level: v.language_levels
        ? {
            sortOrder: v.language_levels.sort_order,
            personal: v.language_levels.owner_user_id !== null,
          }
        : null,
      schemaVersion: v.schema_version,
      content: v.content,
    })),
  );
  const chosen = ordered.filter((v) => versionIds.includes(v.id));
  return {
    id: item.data.id,
    type: item.data.type,
    title: item.data.title,
    faith: {
      connection: item.data.catholic_connection,
      onStudentSheet: item.data.faith_on_student_sheet,
    },
    versions: (chosen.length ? chosen : ordered).map((v) => ({
      id: v.id,
      number: v.number,
      schemaVersion: v.schemaVersion,
      content: v.content,
    })),
  };
}

/**
 * The answer keys of some versions of an item, as stored (staff views only: the teacher copy and
 * the teacher print, D-062). Keys of versions of other items are never returned.
 */
export async function loadItemKeys(
  itemId: string,
  versionIds: readonly string[],
): Promise<Map<string, unknown>> {
  if (!versionIds.length) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('library_item_answer_keys')
    .select('version_id, answer_key, library_item_versions!inner(item_id)')
    .eq('library_item_versions.item_id', itemId)
    .in('version_id', [...versionIds]);
  return new Map((data ?? []).map((k) => [k.version_id, k.answer_key]));
}
