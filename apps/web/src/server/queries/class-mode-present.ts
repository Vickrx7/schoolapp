import 'server-only';
import { isLibraryItemType } from '@lynx/content';
import { cache } from 'react';
import type { PresenterSource } from '../class-mode/presenter';
import { versionOrder } from '../library/view-model';
import type { SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * What « Présenter à la classe » is built from (DECISIONS D-082, D-086), read as the user: row
 * level security decides what is readable, and an item the user cannot read is not found. Like
 * the student sheet's loader (`loadItemForStudentSheet`), it reads only what the slides need: the
 * item's type, title, materials, duration and subject, and its versions' content. It never reads
 * the answer keys (only which versions have one), the safety notes or a level's name; level rows
 * give only their order, so the base version comes first. Cached per request (the page and its
 * metadata both ask).
 */
export const loadPresenterSource = cache(
  async (itemId: string, session: SessionContext): Promise<PresenterSource | null> => {
    const supabase = await createSupabaseServerClient();
    const [item, versions, keys] = await Promise.all([
      supabase
        .from('library_items')
        .select(
          'id, type, title, status, share_scope, author_id, is_projectable, materials, duration_minutes, subjects(code)',
        )
        .eq('id', itemId)
        .maybeSingle(),
      supabase
        .from('library_item_versions')
        .select(
          'id, language_level_id, schema_version, content, language_levels(sort_order, owner_user_id)',
        )
        .eq('item_id', itemId),
      supabase
        .from('library_item_answer_keys')
        .select('version_id, library_item_versions!inner(item_id)')
        .eq('library_item_versions.item_id', itemId),
    ]);
    const row = item.data;
    if (!row || !isLibraryItemType(row.type)) return null;
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
        schemaVersion: v.schema_version,
        content: v.content,
      })),
    );
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      projectable: row.is_projectable,
      status: row.status,
      shareScope: row.share_scope,
      mine: row.author_id !== null && row.author_id === session.userId,
      materials: row.materials,
      durationMinutes: row.duration_minutes,
      subjectCode: row.subjects?.code ?? null,
      versions: ordered.map((v) => ({
        id: v.id,
        schemaVersion: v.schemaVersion,
        content: v.content,
        hasKey: withKey.has(v.id),
      })),
    };
  },
);
