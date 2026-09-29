/**
 * The « Vérifier avant d'envoyer » preview of « Consignes détaillées » (DECISIONS D-038 as amended
 * by D-052): the message exactly as it would be sent, with the replaced names marked, and the
 * fields left out because they hold a personal detail, described so the teacher can find them in
 * her planning. Pure (not server-only), so it can be unit tested.
 */
import type { SubPlanAiInput, SubPlanDroppedField } from '@lynx/ai/features/sub-plan';
import type { BlockedKind, Segment } from '@lynx/ai/privacy';

/** Where a left-out field comes from (labels: subPlanAi.fields.*). */
export const subPlanAiFields = [
  'title',
  'objectives',
  'materials',
  'content',
  'subNotes',
  'fallback',
  'subjectLabel',
  'unitTitle',
  'room',
  'eventTitle',
  'levelLabel',
  'levelDescription',
  'faithTitle',
  'faithText',
  'gradeLabel',
] as const;
export type SubPlanAiField = (typeof subPlanAiFields)[number];

export interface SubPlanAiNotSent {
  /** The period the field belongs to: its times and subject (null for the day or a group). */
  block: { start: string; end: string; subject: string } | null;
  /** The group key (« G1 ») for a level's label or description. */
  group: string | null;
  field: SubPlanAiField;
  kinds: BlockedKind[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` split around the markers that replaced names (« Élève A », never inside « Élève AB »). */
export function segmentsOf(text: string, placeholders: readonly string[]): Segment[] {
  const markers = [...new Set(placeholders)].sort((a, b) => b.length - a.length);
  if (markers.length === 0) return text ? [{ text }] : [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${markers.map(escape).join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
    'gu',
  );
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    segments.push({ text: m[0], placeholder: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

const FIELD_OF: Record<string, SubPlanAiField> = {
  'lesson.title': 'title',
  'lesson.objectives': 'objectives',
  'lesson.materials': 'materials',
  'lesson.content': 'content',
  'lesson.subNotes': 'subNotes',
  fallback: 'fallback',
  subjectLabel: 'subjectLabel',
  unitTitle: 'unitTitle',
  room: 'room',
  eventTitle: 'eventTitle',
  levelLabel: 'levelLabel',
  levelDescription: 'levelDescription',
};

/** A left-out field (by its path in the request) as the preview lists it. */
export function describeDropped(
  dropped: SubPlanDroppedField,
  input: SubPlanAiInput,
): SubPlanAiNotSent {
  const [area, key, ...rest] = dropped.path.split('.');
  const field = rest.join('.');
  const base = { block: null, group: null, kinds: dropped.kinds };
  if (area === 'blocks') {
    const b = input.blocks.find((x) => x.key === key);
    return {
      ...base,
      block: b ? { start: b.start, end: b.end, subject: b.subjectLabel } : null,
      field: FIELD_OF[field] ?? 'content',
    };
  }
  if (area === 'groups') {
    return { ...base, group: key ?? null, field: FIELD_OF[field] ?? 'levelDescription' };
  }
  if (area === 'faith') return { ...base, field: key === 'title' ? 'faithTitle' : 'faithText' };
  return { ...base, field: 'gradeLabel' };
}
