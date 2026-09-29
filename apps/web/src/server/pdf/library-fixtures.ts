/**
 * Shared fixtures of the library PDF tests (library-model.test.ts, library-render.test.ts): an
 * item as the item page loads it, its versions, and content whose key and teacher-only fields
 * carry sentinels, so a test can prove where they end up.
 */
import { sampleCanonical, type AnswerKey, type LibraryItemType } from '@lynx/content';
import type { LibraryItemView, LibraryVersionView } from '../library/view-model';
import type { StudentPdfSource } from './library-model';

export const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
export const TEACHER_SENTINEL = 'SENTINELLE-ENSEIGNANT';
/** The demo board's levels, as the item page names them (never printed, D-042). */
export const LEVEL_NAMES = ['Débutant', 'Intermédiaire', 'Avancé', 'Enrichi'] as const;

/** « », é and a narrow no-break space (U+202F), as French is typed. */
export const FRENCH_PROMPT = 'Lis « Le huard » à voix haute\u202f; quelle est l’idée principale?';

export const versionId = (n: number) => `70000000-0000-4000-8000-00000000000${n}`;

export function libraryView(
  type: LibraryItemType,
  over: Partial<LibraryItemView> = {},
): LibraryItemView {
  return {
    id: '60000000-0000-4000-8000-000000000001',
    boardId: 'board',
    schoolId: null,
    schoolName: null,
    type,
    bucket: 'evaluer',
    title: 'Quiz : les nombres jusqu’à 1 000',
    summary: null,
    status: 'board_approved',
    shareScope: 'board',
    source: 'board_created',
    requested: false,
    mine: false,
    authorName: null,
    subject: { id: 'mat', code: 'mat', label: 'Mathématiques', labelFr: 'Mathématiques' },
    grades: [{ code: '3', label: '3e année', labelFr: '3e année' }],
    expectations: [
      {
        id: 'e1',
        code: 'B1.2',
        text: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        textFr: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        verified: false,
        kind: 'specific',
      },
    ],
    tags: [],
    keywords: null,
    durationMinutes: 30,
    materials: 'Crayons',
    licence: null,
    formats: { printable: true, projectable: false, interactive: false },
    subFriendly: true,
    safetyNotes: null,
    faith: {
      content: false,
      connection: null,
      referenceId: null,
      referenceTitle: null,
      onStudentSheet: false,
      requiresReview: false,
      reviewed: false,
    },
    provenance: {
      aiFeature: null,
      promptVersion: null,
      model: null,
      packTitle: null,
      packVersion: null,
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
      approvedAt: null,
      usageCount: 0,
    },
    contentRevision: 1,
    canEdit: false,
    reviewerKinds: [],
    review: null,
    versions: [],
    hasKeys: true,
    ...over,
  };
}

/** Version `number` (1 is the base version; 2 to 5 the board's levels, in order). */
export function versionView(
  number: number,
  content: unknown,
  schemaVersion = 1,
): LibraryVersionView {
  return {
    id: versionId(number),
    languageLevelId: number === 1 ? null : `80000000-0000-4000-8000-00000000000${number}`,
    levelLabel: number === 1 ? null : (LEVEL_NAMES[number - 2] ?? null),
    personalLevel: false,
    number,
    schemaVersion,
    content,
    hasKey: true,
  };
}

/** A sample of `type` whose teacher note and key carry the sentinels. */
export function withSentinels(type: LibraryItemType): {
  content: Record<string, unknown>;
  key: AnswerKey | null;
} {
  const { content, answerKey } = sampleCanonical(type);
  const key = answerKey ? structuredClone(answerKey) : null;
  if (key) {
    for (const answer of key.answers) answer.explanation = KEY_SENTINEL;
    key.solution = KEY_SENTINEL;
  }
  return { content: { ...content, teacherNote: TEACHER_SENTINEL }, key };
}

/** A quiz with the base version and the four board levels, and a key for each. */
export function quizItem(): { item: LibraryItemView; keys: Map<string, unknown> } {
  const { content, key } = withSentinels('quiz');
  const questions = (content.questions as { prompt: string }[]).map((q, i) =>
    i === 0 ? { ...q, prompt: FRENCH_PROMPT } : q,
  );
  const versions = [1, 2, 3, 4, 5].map((n) => versionView(n, { ...content, questions }));
  return {
    item: libraryView('quiz', { versions }),
    keys: new Map(versions.map((v) => [v.id, key])),
  };
}

/** What `loadItemForStudentSheet` returns for some versions of an item (no key, no level name). */
export function studentSource(
  item: LibraryItemView,
  versions: readonly LibraryVersionView[] = item.versions,
): StudentPdfSource {
  return {
    type: item.type,
    title: item.title,
    faith: { connection: item.faith.connection, onStudentSheet: item.faith.onStudentSheet },
    versions: versions.map((v) => ({
      id: v.id,
      number: v.number,
      schemaVersion: v.schemaVersion,
      content: v.content,
    })),
  };
}
