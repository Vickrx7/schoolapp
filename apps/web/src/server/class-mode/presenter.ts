/**
 * « Présenter à la classe » (DECISIONS D-082, D-086, D-090): what the projector page shows and
 * what « Afficher la réponse » may return. The page builds the slides on the server with
 * `presentSlides` (`@lynx/content`) and sends the player only them: never the item, its
 * teacher-only fields, its safety notes, a level name or an answer key. A question's answer
 * leaves the server only when the teacher asks, one question at a time (`presenterAnswer`).
 *
 * Pure (no server-only import), so the rules are unit-tested; `server/queries/class-mode-present.ts`
 * loads the source and `server/actions/class-mode-present.ts` reveals answers.
 */
import {
  CURRENT_SCHEMA_VERSION,
  canPresent,
  contentLang,
  contentSchema,
  parseAnswerKey,
  parseVersionContent,
  presentSlides,
  type DocLang,
  type LibraryItemType,
  type MatchingPair,
  type Slide,
} from '@lynx/content';
import type { LibraryItemStatus, ShareScope } from '@lynx/db';

// ---------------------------------------------------------------------------------------
// Who may present what
// ---------------------------------------------------------------------------------------

export interface PresentableInput {
  type: LibraryItemType;
  /** `library_items.is_projectable`. */
  projectable: boolean;
  status: LibraryItemStatus;
  shareScope: ShareScope;
  /** The user wrote it. */
  mine: boolean;
}

/**
 * « Présenter à la classe » is offered, and the projector page opens, for an item the teacher can
 * use in class (the rule of « Ajouter à ma planification », D-065): her own, or a reviewed or
 * approved item shared with her, never an archived one. A reviewer reading a colleague's item
 * that waits for review does not present it. The type must have a player (quizzes, exit tickets,
 * games, brain breaks, experiments) or the item be marked projectable (D-082).
 */
export function isPresentable(item: PresentableInput): boolean {
  if (!canPresent(item.type, item.projectable)) return false;
  if (item.status === 'archived') return false;
  if (item.mine) return true;
  return (
    (item.status === 'teacher_reviewed' || item.status === 'board_approved') &&
    item.shareScope !== 'private'
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The projector page of an item: `?v=` the version on screen, `?s=` the slide (from 1). */
export function presenterHref(itemId: string, versionId?: string | null, slide?: number): string {
  const params = new URLSearchParams();
  if (versionId && UUID.test(versionId)) params.set('v', versionId.toLowerCase());
  if (slide && slide > 1) params.set('s', String(slide));
  const query = params.toString();
  return `/projector/items/${itemId}${query ? `?${query}` : ''}`;
}

/** The slide asked for in `?s=` (from 1) as an index, within the presentation. */
export function slideIndex(param: string | null | undefined, total: number): number {
  const n = Number.parseInt(param ?? '', 10);
  if (!Number.isFinite(n) || total < 1) return 0;
  return Math.min(Math.max(n, 1), total) - 1;
}

// ---------------------------------------------------------------------------------------
// The presentation
// ---------------------------------------------------------------------------------------

/**
 * What the projector page is built from (`loadPresenterSource`): the item's type, title and the
 * fields the slides use, and its versions' content in version order (the base version first).
 * No level name, no safety note, no answer key: only whether each version has one.
 */
export interface PresenterSource extends PresentableInput {
  id: string;
  title: string;
  /** `library_items.materials`, shown before an experiment's steps. */
  materials: string | null;
  durationMinutes: number | null;
  /** The subject's code (`ang` projects in English, D-090). */
  subjectCode: string | null;
  versions: PresenterVersion[];
}

export interface PresenterVersion {
  id: string;
  schemaVersion: number;
  content: unknown;
  hasKey: boolean;
}

export interface Presentation {
  versionId: string;
  /** The content language: labels on the slides follow it. */
  lang: DocLang;
  /** The title slide's title (the version's own title, else the item's). */
  title: string;
  slides: Slide[];
  /** The slide to open on. */
  index: number;
  /** Some of the stored content could not be read (« Une partie… ne peut pas être affichée »). */
  partial: boolean;
  /** « Afficher la réponse » is offered on question slides. */
  hasKey: boolean;
}

interface ReadContent {
  content: unknown;
  partial: boolean;
}

/**
 * The version's content as the renderers read it (as the item page does, `item-docs.ts`): a
 * version of another schema version, or content that is not this type's, cannot be read;
 * content failing the `draft` schema is read leniently and is « partial ».
 */
function readContent(
  type: LibraryItemType,
  version: Pick<PresenterVersion, 'schemaVersion' | 'content'>,
): ReadContent {
  if (version.schemaVersion !== CURRENT_SCHEMA_VERSION) return { content: {}, partial: true };
  const parsed = parseVersionContent(type, version.content);
  if (!parsed.ok) return { content: {}, partial: true };
  return {
    content: parsed.content,
    partial: !contentSchema(type, 'draft').safeParse(version.content).success,
  };
}

/**
 * The slides of the version asked for (`?v=`; the base version when it is missing or not one of
 * the item's readable versions) and the slide to open on (`?s=`). Null when the item has no
 * readable version, or no slides (a teacher-only type). The title slide always comes first and
 * the end slide last (`presentSlides`).
 */
export function buildPresentation(
  source: PresenterSource,
  wanted: { versionId?: string | null; slide?: string | null },
): Presentation | null {
  const version =
    source.versions.find((v) => v.id === wanted.versionId?.toLowerCase()) ?? source.versions[0];
  if (!version) return null;
  const read = readContent(source.type, version);
  const lang = contentLang(source.subjectCode);
  const slides = presentSlides(source.type, read.content, {
    title: source.title,
    materials: source.materials,
    durationMinutes: source.durationMinutes,
    lang,
  });
  const first = slides[0];
  // Teacher-only types have no slides; they are never presentable anyway.
  if (!first) return null;
  return {
    versionId: version.id,
    lang,
    title: first.kind === 'title' ? first.title : source.title,
    slides,
    index: slideIndex(wanted.slide, slides.length),
    partial: read.partial,
    hasKey: version.hasKey,
  };
}

// ---------------------------------------------------------------------------------------
// « Afficher la réponse »
// ---------------------------------------------------------------------------------------

/**
 * One question's answer as the projector shows it (D-086): the fields of its key entry needed to
 * mark the right choice, pair or order, and its explanation. Nothing else of the key: not the
 * other questions, not the worked solution, not an unknown field.
 */
export type PresenterAnswer =
  | { kind: 'multiple_choice'; correctChoiceIds: string[]; explanation: string }
  | { kind: 'true_false'; correct: boolean; explanation: string }
  | { kind: 'matching'; pairs: MatchingPair[]; explanation: string }
  | { kind: 'ordering'; orderedIds: string[]; explanation: string }
  | {
      kind: 'short_answer';
      sampleAnswer: string;
      acceptableAnswers: string[];
      explanation: string;
    };

const META = { title: '', materials: null, durationMinutes: null, lang: 'fr-CA' } as const;

/** The ids of the questions the presentation shows on question slides (never a document's). */
export function presentedQuestionIds(
  type: LibraryItemType,
  version: Pick<PresenterVersion, 'schemaVersion' | 'content'>,
): string[] {
  const { content } = readContent(type, version);
  return presentSlides(type, content, META).flatMap((slide) =>
    slide.kind === 'question' ? [slide.question.id] : [],
  );
}

/**
 * The answer of one question shown on a question slide of the version, from the version's
 * stored key; null when the question is not on a question slide, or when the key has no entry of
 * the question's kind for it (« Le corrigé n’a pas de réponse pour cette question. »).
 */
export function presenterAnswer(
  type: LibraryItemType,
  version: Pick<PresenterVersion, 'schemaVersion' | 'content'>,
  rawKey: unknown,
  questionId: string,
): PresenterAnswer | null {
  const { content } = readContent(type, version);
  const slide = presentSlides(type, content, META).find(
    (s): s is Extract<Slide, { kind: 'question' }> =>
      s.kind === 'question' && s.question.id === questionId,
  );
  if (!slide || rawKey === null || rawKey === undefined) return null;
  const parsed = parseAnswerKey(rawKey);
  if (!parsed.ok) return null;
  const entry = parsed.key.answers.find((a) => a.questionId === questionId);
  if (!entry || entry.kind !== slide.question.kind) return null;
  // Copied field by field (a whitelist), each checked, so nothing else of the key goes out.
  const explanation = text(entry.explanation);
  switch (entry.kind) {
    case 'multiple_choice':
      return {
        kind: 'multiple_choice',
        correctChoiceIds: ids(entry.correctChoiceIds),
        explanation,
      };
    case 'true_false':
      return typeof entry.correct === 'boolean'
        ? { kind: 'true_false', correct: entry.correct, explanation }
        : null;
    case 'matching':
      return {
        kind: 'matching',
        pairs: (Array.isArray(entry.pairs) ? entry.pairs : []).flatMap((pair) =>
          typeof pair?.leftId === 'string' && typeof pair.rightId === 'string'
            ? [{ leftId: pair.leftId, rightId: pair.rightId }]
            : [],
        ),
        explanation,
      };
    case 'ordering':
      return { kind: 'ordering', orderedIds: ids(entry.orderedIds), explanation };
    case 'short_answer':
      return {
        kind: 'short_answer',
        sampleAnswer: text(entry.sampleAnswer),
        acceptableAnswers: ids(entry.acceptableAnswers)
          .map((a) => a.trim())
          .filter(Boolean),
        explanation,
      };
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
