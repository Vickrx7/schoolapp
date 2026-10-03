/**
 * How many elements each list of a type's content may hold, read from its `final` schema (its
 * JSON Schema, so the editor never repeats a number the schemas already say): the editor
 * disables « Ajouter » at the maximum and says how many are needed below the minimum. Keys are
 * the field paths of `EDITOR_SPEC` joined with dots (`questions`, `sections.questions`,
 * `fr.learning`).
 */
import { EDITOR_SPEC, contentObject, type FieldSpec, type LibraryItemType } from '@lynx/content';
import { z } from 'zod';

export interface ListLimits {
  min: number;
  max: number;
  /** For a list of texts: the maximum length of each. */
  itemMaxLength?: number;
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

/** The object variant of a schema that may also be null. */
function objectOf(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  if (schema.properties) return schema;
  return schema.anyOf?.find((s) => s.properties);
}

function walk(
  specs: readonly FieldSpec[],
  schema: JsonSchema | undefined,
  prefix: string,
  out: Map<string, ListLimits>,
) {
  for (const spec of specs) {
    const key = prefix ? `${prefix}.${spec.path}` : spec.path;
    const field = schema?.properties?.[spec.path];
    if (field?.type === 'array') {
      out.set(key, {
        min: field.minItems ?? 0,
        max: field.maxItems ?? Number.POSITIVE_INFINITY,
        ...(field.items?.type === 'string' && field.items.maxLength !== undefined
          ? { itemMaxLength: field.items.maxLength }
          : {}),
      });
    }
    if (spec.fields) {
      const inner = spec.kind === 'object' ? objectOf(field) : objectOf(field?.items);
      walk(spec.fields, inner, key, out);
    }
  }
}

const CACHE = new Map<LibraryItemType, Map<string, ListLimits>>();

export function listLimits(type: LibraryItemType): Map<string, ListLimits> {
  let limits = CACHE.get(type);
  if (!limits) {
    const json = z.toJSONSchema(contentObject(type, 'final'), {
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchema;
    limits = new Map();
    walk(EDITOR_SPEC[type], json, '', limits);
    CACHE.set(type, limits);
  }
  return limits;
}

/** The limits of one list (`{0, ∞}` when the schema sets none). */
export function limitsOf(type: LibraryItemType, key: string): ListLimits {
  return listLimits(type).get(key) ?? { min: 0, max: Number.POSITIVE_INFINITY };
}
