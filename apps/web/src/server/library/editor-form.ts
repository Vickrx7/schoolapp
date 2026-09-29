/**
 * The library editor's form (« Nouvelle ressource », « Modifier la ressource », DECISIONS D-061,
 * D-063): the item's details and, for each version, its content in the editor's model
 * (`Authoring` from @lynx/content: answers written next to their questions). The browser keeps
 * it as a device draft (D-035), sends it as it is, and the server turns it into what
 * `save_library_item` stores (`save-payload.ts`).
 *
 * Pure: no server-only import, so client components use the types and the tests run it.
 */
import {
  LIBRARY_ITEM_TYPES,
  SUPERVISION_LEVELS,
  TYPE_INFO,
  emptyAuthoring,
  emptySafetyNotes,
  parseAnswerKey,
  parseVersionContent,
  safetyNotesSchema,
  toAuthoring,
  type LibraryItemType,
  type SafetyNotesDraft,
} from '@lynx/content';
import { z } from 'zod';
import type { LibraryItemView } from './view-model';

export interface EditorVersion {
  /** Null for the base version. */
  languageLevelId: string | null;
  /** The content in the editor's model (`Authoring.content`). */
  content: Record<string, unknown>;
  /** `answerKey.solution`: a worked solution, an experiment's expected results… */
  solution: string;
}

export interface LibraryEditorForm {
  type: LibraryItemType;
  boardId: string;
  /** The school the item is shared with when « Avec mon école » is chosen. */
  schoolId: string | null;
  title: string;
  summary: string;
  licence: string;
  subjectId: string | null;
  gradeCodes: string[];
  expectationIds: string[];
  tagIds: string[];
  keywords: string;
  durationMinutes: number | null;
  materials: string;
  isPrintable: boolean;
  isProjectable: boolean;
  isInteractive: boolean;
  subFriendly: boolean;
  /** Experiments and STEM challenges only (null for every other type). */
  safetyNotes: SafetyNotesDraft | null;
  faithContent: boolean;
  faithOnStudentSheet: boolean;
  catholicConnection: string;
  catholicReferenceId: string | null;
  /** The base version first, then level versions in the order the author added them. */
  versions: EditorVersion[];
}

/**
 * The form as the save action receives it. Sizes here are only a ceiling against abuse: the
 * real limits (and their error keys) are `libraryItemFormSchema`'s, checked after conversion.
 */
export const editorFormSchema = z.strictObject({
  type: z.enum(LIBRARY_ITEM_TYPES),
  boardId: z.uuid(),
  schoolId: z.uuid().nullable(),
  title: z.string().max(2000),
  summary: z.string().max(10_000),
  licence: z.string().max(2000),
  subjectId: z.uuid().nullable(),
  gradeCodes: z.array(z.string().max(8)).max(20),
  expectationIds: z.array(z.uuid()).max(60),
  tagIds: z.array(z.uuid()).max(60),
  keywords: z.string().max(3000),
  durationMinutes: z.number().nullable(),
  materials: z.string().max(40_000),
  isPrintable: z.boolean(),
  isProjectable: z.boolean(),
  isInteractive: z.boolean(),
  subFriendly: z.boolean(),
  safetyNotes: z
    .strictObject({
      ageSuitability: z.string().max(3000),
      allergyAwareMaterials: z.string().max(6000),
      supervision: z.enum([...SUPERVISION_LEVELS, '']),
      hazards: z.array(z.string().max(3000)).max(50),
      notes: z.string().max(10_000),
    })
    .nullable(),
  faithContent: z.boolean(),
  faithOnStudentSheet: z.boolean(),
  catholicConnection: z.string().max(20_000),
  catholicReferenceId: z.uuid().nullable(),
  versions: z
    .array(
      z.strictObject({
        languageLevelId: z.uuid().nullable(),
        content: z.record(z.string(), z.unknown()),
        solution: z.string().max(80_000),
      }),
    )
    .min(1)
    .max(8),
});

/** What a new item starts from (« Nouvelle ressource »). */
export interface NewItemDefaults {
  boardId: string;
  schoolId: string | null;
  gradeCodes?: string[];
  subjectId?: string | null;
  expectationIds?: string[];
}

export function emptyEditorForm(
  type: LibraryItemType,
  defaults: NewItemDefaults,
): LibraryEditorForm {
  const info = TYPE_INFO[type];
  const authoring = emptyAuthoring(type);
  return {
    type,
    boardId: defaults.boardId,
    schoolId: defaults.schoolId,
    title: '',
    summary: '',
    licence: '',
    subjectId: defaults.subjectId ?? null,
    gradeCodes: defaults.gradeCodes ?? [],
    expectationIds: defaults.expectationIds ?? [],
    tagIds: [],
    keywords: '',
    durationMinutes: info.defaultDuration,
    materials: '',
    isPrintable: info.defaultFormats.printable,
    isProjectable: info.defaultFormats.projectable,
    isInteractive: info.defaultFormats.interactive,
    subFriendly: false,
    safetyNotes: info.needsSafety ? emptySafetyNotes() : null,
    faithContent: type === 'catholic_reflection',
    faithOnStudentSheet: type === 'catholic_reflection',
    catholicConnection: '',
    catholicReferenceId: null,
    versions: [{ languageLevelId: null, content: authoring.content, solution: authoring.solution }],
  };
}

/** Stored safety notes as the editor holds them (what is missing stays empty). */
export function editorSafetyNotes(type: LibraryItemType, stored: unknown): SafetyNotesDraft | null {
  if (!TYPE_INFO[type].needsSafety) return null;
  const parsed = safetyNotesSchema('draft').safeParse(stored);
  if (parsed.success) return parsed.data;
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const supervision = (SUPERVISION_LEVELS as readonly string[]).includes(text(raw.supervision))
    ? (text(raw.supervision) as SafetyNotesDraft['supervision'])
    : '';
  return {
    ...emptySafetyNotes(),
    ageSuitability: text(raw.ageSuitability),
    allergyAwareMaterials: text(raw.allergyAwareMaterials),
    supervision,
    hazards: Array.isArray(raw.hazards) ? raw.hazards.map(text).filter(Boolean) : [],
    notes: text(raw.notes),
  };
}

/**
 * The form of an item being edited, from what the item page loads: each version's content back
 * in the editor's model with its answers (a version that cannot be read starts empty, like a new
 * one, rather than blocking the editor).
 */
export function editorFormFromItem(
  item: LibraryItemView,
  keys: ReadonlyMap<string, unknown>,
): LibraryEditorForm {
  const versions = item.versions.map((v): EditorVersion => {
    const parsed = parseVersionContent(item.type, v.content);
    const rawKey = keys.get(v.id);
    const key = rawKey == null ? null : parseAnswerKey(rawKey);
    const authoring = parsed.ok
      ? toAuthoring(item.type, parsed.content, key?.ok ? key.key : null)
      : emptyAuthoring(item.type);
    return {
      languageLevelId: v.languageLevelId,
      content: authoring.content,
      solution: authoring.solution,
    };
  });
  return {
    type: item.type,
    boardId: item.boardId,
    schoolId: item.schoolId,
    title: item.title,
    summary: item.summary ?? '',
    licence: item.licence ?? '',
    subjectId: item.subject?.id ?? null,
    gradeCodes: item.grades.map((g) => g.code),
    expectationIds: item.expectations.map((e) => e.id),
    tagIds: item.tags.map((t) => t.id),
    keywords: item.keywords ?? '',
    durationMinutes: item.durationMinutes,
    materials: item.materials ?? '',
    isPrintable: item.formats.printable,
    isProjectable: item.formats.projectable,
    isInteractive: item.formats.interactive,
    subFriendly: item.subFriendly,
    safetyNotes: editorSafetyNotes(item.type, item.safetyNotes),
    faithContent: item.faith.content,
    faithOnStudentSheet: item.faith.onStudentSheet,
    catholicConnection: item.faith.connection ?? '',
    catholicReferenceId: item.faith.referenceId,
    versions: versions.length
      ? versions
      : emptyEditorForm(item.type, { boardId: item.boardId, schoolId: item.schoolId }).versions,
  };
}

/** A new level version, copied from the base version (« Ajouter une version »). */
export function copyOfBase(form: LibraryEditorForm, languageLevelId: string): EditorVersion {
  const base = form.versions.find((v) => v.languageLevelId === null) ?? form.versions[0]!;
  return {
    languageLevelId,
    content: structuredClone(base.content),
    solution: base.solution,
  };
}
