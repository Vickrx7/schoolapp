/**
 * Shape walkers over the `draft` schemas (internal). `conform` gives any value the shape of a
 * schema: unknown keys are dropped, missing strings become `''`, missing lists `[]`, and values
 * of the wrong type are replaced by an empty value of the right type. Values of the right type
 * are kept even when they break a rule (an unknown question kind, a text too long), so that
 * `final` can report them with their path.
 */
import { z } from 'zod';
import { ANSWER_ENTRY_SCHEMAS, QUESTION_SCHEMAS } from './questions';

export interface ConformHooks {
  /** Converts a question (e.g. the flat `ai` shape) before it is walked. */
  question?: (value: unknown) => unknown;
  /** Converts an answer-key entry before it is walked. */
  entry?: (value: unknown) => unknown;
  /** Maps a string to one of the enum's values when it is close enough (`Définir` → `definir`). */
  enumValue?: (value: string, options: readonly string[]) => string;
  /**
   * Keep numbers and booleans of the wrong type as they are, so `final` reports them (AI
   * output), instead of replacing them with `null` and `false` (rendering stored content).
   */
  keepInvalid?: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type AnySchema = z.ZodType;

function literalValues(schema: AnySchema): unknown[] {
  return schema instanceof z.ZodLiteral ? [...schema.values] : [];
}

/** The option of a discriminated union whose `kind` literal is `kind`. */
function optionFor(
  union: z.ZodDiscriminatedUnion,
  kind: unknown,
): z.ZodObject<Record<string, AnySchema>> | undefined {
  return (union.options as unknown as z.ZodObject<Record<string, AnySchema>>[]).find((option) =>
    literalValues(option.shape.kind as AnySchema).includes(kind),
  );
}

/** Fields shared by every option of a union (a question of an unknown kind keeps these). */
function commonShape(union: z.ZodDiscriminatedUnion): Record<string, AnySchema> {
  const options = union.options as unknown as z.ZodObject<Record<string, AnySchema>>[];
  const first = options[0]!.shape;
  const shape: Record<string, AnySchema> = {};
  for (const key of Object.keys(first)) {
    if (key !== 'kind' && options.every((o) => key in o.shape)) shape[key] = first[key]!;
  }
  return shape;
}

export function conform(schema: AnySchema, value: unknown, hooks: ConformHooks = {}): unknown {
  if (QUESTION_SCHEMAS.has(schema) && hooks.question) value = hooks.question(value);
  if (ANSWER_ENTRY_SCHEMAS.has(schema) && hooks.entry) value = hooks.entry(value);

  if (schema instanceof z.ZodNullable) {
    return value === null || value === undefined
      ? null
      : conform(schema.unwrap() as AnySchema, value, hooks);
  }
  if (schema instanceof z.ZodDefault) {
    return value === undefined ? undefined : conform(schema.unwrap() as AnySchema, value, hooks);
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const object = isPlainObject(value) ? value : {};
    const option = optionFor(schema, object.kind);
    // The hook already ran for this question; the option (a question schema too) skips it.
    if (option) return conform(option, object, { ...hooks, question: undefined, entry: undefined });
    // Unknown kind: keep it (so `final` reports it) with the shared fields.
    const shape = commonShape(schema);
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      result[key] = conform(field, object[key], hooks);
      if (key === 'id') result.kind = typeof object.kind === 'string' ? object.kind : '';
    }
    return result;
  }
  if (schema instanceof z.ZodObject) {
    const object = isPlainObject(value) ? value : {};
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.shape as Record<string, AnySchema>)) {
      const conformed = conform(field, object[key], hooks);
      if (conformed !== undefined) result[key] = conformed;
    }
    return result;
  }
  if (schema instanceof z.ZodArray) {
    return Array.isArray(value)
      ? value.map((item) => conform(schema.element as AnySchema, item, hooks))
      : [];
  }
  if (schema instanceof z.ZodLiteral) {
    return typeof value === 'string' ? value : (schema.values.values().next().value ?? '');
  }
  if (schema instanceof z.ZodEnum) {
    const options = schema.options as readonly string[];
    if (typeof value !== 'string') return '';
    return hooks.enumValue ? hooks.enumValue(value, options) : value;
  }
  if (schema instanceof z.ZodString) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }
  if (schema instanceof z.ZodNumber) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return hooks.keepInvalid && value !== undefined ? value : null;
  }
  if (schema instanceof z.ZodBoolean) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return hooks.keepInvalid && value !== undefined ? value : false;
  }
  return value;
}

/** An empty value of the schema's shape: `''`, `[]`, `null`, `false`, the smallest number. */
export function emptyFromSchema(schema: AnySchema): unknown {
  if (schema instanceof z.ZodNullable) return null;
  if (schema instanceof z.ZodDefault) return emptyFromSchema(schema.unwrap() as AnySchema);
  if (schema instanceof z.ZodObject) {
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.shape as Record<string, AnySchema>)) {
      result[key] = emptyFromSchema(field);
    }
    return result;
  }
  if (schema instanceof z.ZodArray) return [];
  if (schema instanceof z.ZodString) return '';
  if (schema instanceof z.ZodNumber) return schema.minValue ?? 0;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodEnum) return (schema.options as readonly string[])[0] ?? '';
  if (schema instanceof z.ZodLiteral) return schema.values.values().next().value ?? '';
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return emptyFromSchema(schema.options[0] as unknown as AnySchema);
  }
  return null;
}

/** Folds a string for loose matching: lowercase, no accents, separators as `_`. */
export function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-’']+/g, '_');
}

/** `enumValue` hook: `Définir` → `definir`, `adult only` → `adult_only`. */
export function looseEnumValue(value: string, options: readonly string[]): string {
  const folded = foldKey(value);
  return options.find((o) => foldKey(o) === folded) ?? value.trim();
}
