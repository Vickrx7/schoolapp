import { TYPE_INFO } from '@lynx/content';
import { getLocale } from 'next-intl/server';
import { loadLanguageLevels } from '@/server/queries/differentiate';
import type { LibraryItemView } from '@/server/library/view-model';
import { aiOn, librarySchools, requireSession } from '@/server/session';
import { LevelsAiButton } from '../levels-ai-button';

/**
 * « Créer les versions manquantes avec l’IA » on the item page (slice S8, D-073): for the
 * item's editors, when the type has levels, some active board levels have no version yet, and
 * AI is on at one of the editor's library schools in the item's board (the request is paid by
 * that school). Rendered on the server right under the version picker. The database checks it
 * all again (`request_library_levels`).
 */
export async function LevelsAiSlot({ item }: { item: LibraryItemView }) {
  if (!item.canEdit || !TYPE_INFO[item.type].levelable) return null;
  const session = await requireSession();
  const school = librarySchools(session).find(
    (s) => s.boardId === item.boardId && aiOn(session, s),
  );
  if (!school) return null;
  const have = new Set(item.versions.map((v) => v.languageLevelId));
  const missing = (await loadLanguageLevels(await getLocale()))
    .filter((l) => l.boardId === item.boardId && !l.personal && l.active && !have.has(l.id))
    .map((l) => ({ id: l.id, label: l.label }));
  if (!missing.length) return null;
  return <LevelsAiButton itemId={item.id} schoolId={school.id} missing={missing} />;
}
