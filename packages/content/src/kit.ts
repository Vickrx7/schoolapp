/**
 * Schema building blocks (DECISIONS P-1). Every content schema is written once, as a function
 * of a `Kit`, and built in three modes:
 *
 * - `draft`: maximum sizes, strict objects (unknown keys are rejected, so an answer can't slip
 *   into student content), empty values allowed. Used on every save.
 * - `final`: minimums, maximums and cross-field rules. Needed to mark an item reviewed.
 * - `ai`: the same fields with no enum, literal, pattern or size constraint, because structured
 *   outputs don't enforce them and a violation would fail parsing with no path. Everything is
 *   required (nullable where the canonical field is). `normalizeAiContent` converts the result
 *   to canonical content, and `final` then reports every rule with its path.
 *
 * Messages are error keys (`libraryEdit.errors.<key>`), never sentences.
 */
import { z } from 'zod';

export const SCHEMA_MODES = ['ai', 'draft', 'final'] as const;
export type SchemaMode = (typeof SCHEMA_MODES)[number];

/** Question, choice and item ids: short, lowercase, stable (`q1`, `c2`, `ra`). */
export const ID_PATTERN = /^[a-z][a-z0-9]{0,7}$/;

/** The error keys used by content schemas. */
export const CONTENT_ERROR_KEYS = [
  'required',
  'tooLong',
  'tooMany',
  'tooFew',
  'tooSmall',
  'tooLarge',
  'invalid',
  // Cross-field rules of `final`.
  'worksheetEmpty',
  'missingCategory',
] as const;
export type ContentErrorKey = (typeof CONTENT_ERROR_KEYS)[number];

export interface Kit {
  mode: SchemaMode;
  /** A string that `final` requires to be non-blank. */
  text(max: number): z.ZodType<string>;
  /** A string that may stay empty. */
  optText(max: number): z.ZodType<string>;
  list<T>(item: z.ZodType<T>, min: number, max: number): z.ZodType<T[]>;
  enumOf<const V extends readonly [string, ...string[]]>(values: V): z.ZodType<V[number]>;
  id: z.ZodType<string>;
  int(min: number, max: number): z.ZodType<number>;
  bool: z.ZodType<boolean>;
  obj<S extends Record<string, z.ZodType>>(shape: S): z.ZodObject<S>;
}

const invalid = { error: 'invalid' } as const;

function aiKit(): Kit {
  return {
    mode: 'ai',
    text: () => z.string(),
    optText: () => z.string(),
    list: <T>(item: z.ZodType<T>) => z.array(item),
    enumOf: <const V extends readonly [string, ...string[]]>() =>
      z.string() as unknown as z.ZodType<V[number]>,
    id: z.string(),
    // Not z.int(): its JSON schema carries the safe-integer minimum and maximum.
    int: () => z.number(),
    bool: z.boolean(),
    obj: <S extends Record<string, z.ZodType>>(shape: S) => z.object(shape),
  };
}

function strictKit(mode: 'draft' | 'final'): Kit {
  const final = mode === 'final';
  const bounded = (max: number) => z.string(invalid).max(max, 'tooLong');
  return {
    mode,
    text: (max) =>
      final ? bounded(max).refine((s) => s.trim().length > 0, 'required') : bounded(max),
    optText: bounded,
    list: <T>(item: z.ZodType<T>, min: number, max: number) => {
      const array = z.array(item, invalid).max(max, 'tooMany');
      return final && min > 0 ? array.min(min, 'tooFew') : array;
    },
    enumOf: <const V extends readonly [string, ...string[]]>(values: V) =>
      z.enum(values as unknown as [string, ...string[]], invalid) as unknown as z.ZodType<
        V[number]
      >,
    id: z.string(invalid).regex(ID_PATTERN, 'invalid'),
    int: (min, max) => z.number(invalid).int('invalid').min(min, 'tooSmall').max(max, 'tooLarge'),
    bool: z.boolean(invalid),
    obj: <S extends Record<string, z.ZodType>>(shape: S) =>
      z.strictObject(shape, invalid) as unknown as z.ZodObject<S>,
  };
}

const KITS: Record<SchemaMode, Kit> = {
  ai: aiKit(),
  draft: strictKit('draft'),
  final: strictKit('final'),
};

export function kit(mode: SchemaMode): Kit {
  return KITS[mode];
}

/** The error key of a Zod issue: its message when it is a key, else `invalid`. */
export function issueKey(issue: { message: string }): ContentErrorKey {
  return (CONTENT_ERROR_KEYS as readonly string[]).includes(issue.message)
    ? (issue.message as ContentErrorKey)
    : 'invalid';
}
