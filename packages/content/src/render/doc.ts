/**
 * One document model for screen, print and PDF (DECISIONS P-15). The web app draws it as HTML
 * (`DocView`) and with react-pdf (`DocBlocks`); substitute plans store it in their snapshots,
 * so it has a strict schema. Student documents and teacher documents are separate documents,
 * and answer keys are a third one.
 */
import { z } from 'zod';
import { QUESTION_KINDS, type QuestionKind } from '../questions';

export const DOC_LANGS = ['fr-CA', 'en-CA'] as const;
export type DocLang = (typeof DOC_LANGS)[number];

export const CALLOUT_TONES = ['info', 'teacher', 'safety', 'faith', 'warning'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export interface DocOption {
  /** « A », « 1 », or `''` (true/false, ordering boxes). */
  label: string;
  text: string;
}

export interface QuestionBlock {
  type: 'question';
  /** 1-based and continuous through the document; the answer key uses the same numbers. */
  number: number;
  kind: QuestionKind;
  prompt: string;
  hint: string;
  points: number | null;
  /** Achievement-chart category label: teacher documents only. */
  category: string | null;
  /** Multiple choice (A, B…), true/false (Vrai, Faux), ordering items (display order). */
  choices: DocOption[];
  multipleAnswers: boolean;
  /** Matching: left column (1, 2…) and right column (A, B…, display order). */
  left: DocOption[];
  right: DocOption[];
  /** Writing lines for a short answer; 0 otherwise. */
  lines: number;
}

export type LeafBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'steps'; items: { text: string; minutes: number | null; detail: string }[] }
  | { type: 'glossary'; entries: { term: string; definition: string }[] }
  | QuestionBlock
  | { type: 'table'; caption: string; columns: string[]; rows: string[][] }
  | { type: 'lines'; count: number }
  | { type: 'callout'; tone: CalloutTone; title: string; text: string; items: string[] }
  | {
      type: 'rubric';
      caption: string;
      levels: string[];
      rows: { category: string; criterion: string; cells: string[] }[];
    }
  | { type: 'answer'; number: number; text: string; details: string[]; explanation: string }
  | { type: 'poem'; title: string; lines: string[] };

/** Content in another language (the English half of a family guide) is a section. */
export interface SectionBlock {
  type: 'section';
  lang: DocLang;
  title: string;
  blocks: LeafBlock[];
}

export type DocBlock = LeafBlock | SectionBlock;

export interface RenderedDoc {
  kind: 'student' | 'teacher' | 'answerKey';
  /** Content language (`lang` attribute). */
  lang: DocLang;
  title: string;
  subtitle: string;
  /** The small version number printed on the page (never a level name, D-042). */
  number: number | null;
  blocks: DocBlock[];
}

const text = (max = 50_000) => z.string().max(max);
const many = <T extends z.ZodType>(item: T, max = 500) => z.array(item).max(max);
const option = z.strictObject({ label: text(8), text: text(2000) });

const leafBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: text(500),
  }),
  z.strictObject({ type: z.literal('paragraph'), text: text() }),
  z.strictObject({ type: z.literal('list'), ordered: z.boolean(), items: many(text(5000)) }),
  z.strictObject({
    type: z.literal('steps'),
    items: many(
      z.strictObject({
        text: text(5000),
        minutes: z.number().int().min(0).max(600).nullable(),
        detail: text(5000),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal('glossary'),
    entries: many(z.strictObject({ term: text(200), definition: text(2000) })),
  }),
  z.strictObject({
    type: z.literal('question'),
    number: z.number().int().min(1).max(1000),
    kind: z.enum(QUESTION_KINDS),
    prompt: text(5000),
    hint: text(2000),
    points: z.number().min(0).max(1000).nullable(),
    category: text(200).nullable(),
    choices: many(option, 20),
    multipleAnswers: z.boolean(),
    left: many(option, 20),
    right: many(option, 20),
    lines: z.number().int().min(0).max(40),
  }),
  z.strictObject({
    type: z.literal('table'),
    caption: text(500),
    columns: many(text(500), 20),
    rows: many(many(text(2000), 20), 100),
  }),
  z.strictObject({ type: z.literal('lines'), count: z.number().int().min(1).max(40) }),
  z.strictObject({
    type: z.literal('callout'),
    tone: z.enum(CALLOUT_TONES),
    title: text(500),
    text: text(),
    items: many(text(5000), 50),
  }),
  z.strictObject({
    type: z.literal('rubric'),
    caption: text(1000),
    levels: many(text(100), 8),
    rows: many(
      z.strictObject({ category: text(200), criterion: text(1000), cells: many(text(2000), 8) }),
      50,
    ),
  }),
  z.strictObject({
    type: z.literal('answer'),
    number: z.number().int().min(1).max(1000),
    text: text(10_000),
    details: many(text(5000), 50),
    explanation: text(5000),
  }),
  z.strictObject({ type: z.literal('poem'), title: text(500), lines: many(text(2000), 200) }),
]);

export const docBlockSchema: z.ZodType<DocBlock> = z.union([
  leafBlockSchema,
  z.strictObject({
    type: z.literal('section'),
    lang: z.enum(DOC_LANGS),
    title: text(500),
    blocks: many(leafBlockSchema),
  }),
]);

export const renderedDocSchema: z.ZodType<RenderedDoc> = z.strictObject({
  kind: z.enum(['student', 'teacher', 'answerKey']),
  lang: z.enum(DOC_LANGS),
  title: text(500),
  subtitle: text(500),
  number: z.number().int().min(1).max(99).nullable(),
  blocks: many(docBlockSchema, 2000),
});
