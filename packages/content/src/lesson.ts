/**
 * A library item as a new lesson of a unit (DECISIONS P-16): `add_library_item_to_unit` copies
 * this outline once, keeps the link, and does not follow later changes to the item. Sizes match
 * the `unit_lessons` columns.
 */
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { isPlainObject } from './conform';
import { renderContentBlocks } from './render/content';
import { docToPlainText } from './render/plain';
import { guillemets } from './style';

export interface LessonSourceItem {
  type: LibraryItemType;
  title: string;
  materials: string | null;
  durationMinutes: number | null;
  /** For the phase labels of a lesson plan. */
  subjectCode?: string | null;
}

export interface LessonOutline {
  title: string;
  objectives: string;
  materials: string;
  content: string;
  subNotes: string;
  durationMinutes: number | null;
}

export const LESSON_LIMITS = {
  title: 160,
  objectives: 4000,
  materials: 4000,
  content: 20_000,
  subNotes: 4000,
} as const;

/** Cuts text to `max` characters, ending with « … » when it was cut. */
export function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function lessonFromItem(
  item: LessonSourceItem,
  content: unknown,
  expectations: readonly { code: string; text: string }[],
): LessonOutline {
  const c = isPlainObject(content) ? content : {};
  const title = str(c.title) || item.title.trim();
  const objectives = str(c.objective) || expectations.map((e) => e.text.trim()).join('\n');

  let body: string;
  if (TYPE_INFO[item.type].audience === 'teacher' || item.type === 'project') {
    // The plan itself, flattened: phases with their steps and minutes. Sub notes have a column.
    const { subNotes: _subNotes, ...rest } = c;
    const blocks = renderContentBlocks(item.type, rest, 'teacher', {
      subjectCode: item.subjectCode,
    });
    body = docToPlainText({
      kind: 'teacher',
      lang: 'fr-CA',
      title: '',
      subtitle: '',
      number: null,
      blocks,
    });
  } else {
    const hand =
      TYPE_INFO[item.type].audience === 'family'
        ? `Remettez le guide ${guillemets(title)} aux familles.`
        : `Distribuez la feuille ${guillemets(title)}.`;
    body = [hand, str(c.instructions) || str(c.prompt)].filter(Boolean).join('\n\n');
  }

  return {
    title: clip(title, LESSON_LIMITS.title),
    objectives: clip(objectives, LESSON_LIMITS.objectives),
    materials: clip(item.materials ?? '', LESSON_LIMITS.materials),
    content: clip(body, LESSON_LIMITS.content),
    subNotes: clip(item.type === 'lesson_plan' ? str(c.subNotes) : '', LESSON_LIMITS.subNotes),
    durationMinutes: item.durationMinutes,
  };
}
