/**
 * Content pack format v1 (Phase 5 plan P-18 and P-19; DECISIONS D-071, D-081): one UTF-8 JSON
 * file that carries a board's resources to another install, through the admin CLI's
 * `export-pack` and `import-pack`.
 *
 * - References are by code: subject, grade and attente codes (with the exact curriculum
 *   version), level codes, tag slugs and Catholic references as (type, title). There are no
 *   database ids, no user ids, no names and no school data.
 * - Item content is checked in `final` mode, answer keys with `validateAnswerKey`, and the types
 *   that need them carry complete safety notes.
 * - Each item has a stable `key` and a `hash` (`itemHash`); the file has a `checksum` over the
 *   items (`packChecksum`). They catch damaged or edited files; they do not prove who published
 *   a pack (signed packs come later).
 *
 * Pack files contain answer keys: they are confidential and never hosted publicly.
 */
import { z } from 'zod';
import { validateAnswerKey } from './answer-key';
import { LIBRARY_ITEM_TYPES, TYPE_INFO } from './catalog';
import { conform, isPlainObject } from './conform';
import { questionSchemas } from './questions';
import { questionsOf } from './questions-of';
import { safetyNotesSchema } from './safety';
import {
  answerKeySchema,
  contentObject,
  contentSchema,
  CURRENT_SCHEMA_VERSION,
  GRADE_CODE_PATTERN,
} from './schemas';
import { SLUG_PATTERN, seedItemSchema, seedPackSchema, type SeedItem } from './seed-pack';
import { sha256Hex } from './sha256';

export const CONTENT_PACK_FORMAT = 'lynx-content-pack';
export const CONTENT_PACK_FORMAT_VERSION = 1;

/** `YYYY.N` (`2026.2`): the database's `^\d{4}\.\d{1,3}$`, without a leading zero in N. */
export const PACK_VERSION_PATTERN = /^\d{4}\.[1-9]\d{0,2}$/;
/** An item's stable key: its seed slug, or its id when it was never in a pack. */
export const PACK_ITEM_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** At most this many items in one file. */
export const PACK_MAX_ITEMS = 5000;

/** `public.catholic_reference_type`. */
export const CATHOLIC_REFERENCE_TYPES = [
  'virtue',
  'graduate_expectation',
  'reflection',
  'prayer',
  'scripture',
] as const;
export type CatholicReferenceType = (typeof CATHOLIC_REFERENCE_TYPES)[number];

export const PACK_ITEM_SOURCES = ['board_created', 'teacher_created', 'ai_generated'] as const;

// ---------------------------------------------------------------------------------------
// Schemas. Messages are error keys; nothing is transformed, so a parsed item hashes like the
// file's.
// ---------------------------------------------------------------------------------------

const text = (max: number) => z.string({ error: 'invalid' }).max(max, 'tooLong');
const nonBlank = (max: number) => text(max).refine((s) => s.trim() !== '', 'required');
const slug = z.string({ error: 'invalid' }).regex(SLUG_PATTERN, 'invalid');
const levelCode = z.string({ error: 'invalid' }).regex(/^[a-z0-9_]{2,32}$/, 'invalid');
const gradeCode = z.string({ error: 'invalid' }).regex(GRADE_CODE_PATTERN, 'invalid');
const bool = z.boolean({ error: 'invalid' });
const list = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z.array(item, { error: 'invalid' }).min(min, 'tooFew').max(max, 'tooMany');

export const packHeaderSchema = z.strictObject({
  slug,
  version: z.string({ error: 'invalid' }).regex(PACK_VERSION_PATTERN, 'invalid'),
  title: nonBlank(160),
  /** « Éditeur déclaré »: self-declared. */
  publisher: nonBlank(120),
  licence: text(500),
  /** The items may not be adapted (« Adapter », P-11). */
  noDerivatives: bool,
  createdAt: z.iso.datetime({ offset: true, error: 'invalid' }),
  contentSchemaVersion: z.literal(CURRENT_SCHEMA_VERSION, { error: 'schemaVersion' }),
});
export type PackHeader = z.output<typeof packHeaderSchema>;

/** A board level of the exporting board; versions name it by code. */
export const packLevelSchema = z.strictObject({
  code: levelCode,
  labelFr: nonBlank(60),
  labelEn: text(60).nullable(),
});
export type PackLevel = z.output<typeof packLevelSchema>;

export const packTagSchema = z.strictObject({ slug, labelFr: nonBlank(60) });
export type PackTag = z.output<typeof packTagSchema>;

export const packReferenceSchema = z.strictObject({
  type: z.enum(CATHOLIC_REFERENCE_TYPES, { error: 'invalid' }),
  title: nonBlank(160),
});
export type PackReference = z.output<typeof packReferenceSchema>;

export const packExpectationSchema = z.strictObject({
  curriculumVersion: nonBlank(40),
  gradeCode,
  code: nonBlank(20),
});

const packVersionSchema = z.strictObject({
  /** A board level's code; null for the base version. */
  level: levelCode.nullable(),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION, { error: 'schemaVersion' }),
  content: z.record(z.string(), z.unknown(), { error: 'invalid' }),
  answerKey: z.record(z.string(), z.unknown(), { error: 'invalid' }).nullable(),
});

type Issue = (path: (string | number)[], message: string) => void;

function checkUnique(values: readonly string[], path: string, issue: Issue): void {
  values.forEach((value, i) => {
    if (values.indexOf(value) !== i) issue([path, i], 'duplicate');
  });
}

export const contentPackItemSchema = z
  .strictObject({
    key: z.string({ error: 'invalid' }).regex(PACK_ITEM_KEY_PATTERN, 'invalid'),
    /** `itemHash` of the item. */
    hash: z.string({ error: 'invalid' }).regex(SHA256_PATTERN, 'invalid'),
    type: z.enum(LIBRARY_ITEM_TYPES, { error: 'unknownType' }),
    title: nonBlank(200),
    summary: text(1000),
    gradeCodes: list(gradeCode, 1, 4),
    subjectCode: z.string({ error: 'invalid' }).regex(/^[a-z0-9_]{2,32}$/, 'invalid'),
    expectations: list(packExpectationSchema, 0, 12),
    durationMinutes: z
      .number({ error: 'invalid' })
      .int('invalid')
      .min(1, 'tooSmall')
      .max(600, 'tooLarge')
      .nullable(),
    materials: text(4000),
    keywords: text(300),
    formats: z.strictObject({ printable: bool, projectable: bool, interactive: bool }),
    safetyNotes: safetyNotesSchema('final').nullable(),
    faith: z.strictObject({
      faithContent: bool,
      catholicConnection: text(2000),
      reference: packReferenceSchema.nullable(),
      onStudentSheet: bool,
    }),
    tags: list(slug, 0, 10),
    licence: text(200),
    noDerivatives: bool,
    provenance: z.strictObject({
      source: z.enum(PACK_ITEM_SOURCES, { error: 'invalid' }),
      promptVersion: text(40).nullable(),
      model: text(80).nullable(),
    }),
    versions: list(packVersionSchema, 1, 8),
  })
  .superRefine((item, ctx) => {
    const issue: Issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    const info = TYPE_INFO[item.type];
    if (!info) return;

    const levels = item.versions.map((v) => v.level ?? 'base');
    if (levels.filter((l) => l === 'base').length !== 1) issue(['versions'], 'baseVersion');
    levels.forEach((level, i) => {
      if (levels.indexOf(level) !== i) issue(['versions', i, 'level'], 'duplicateLevel');
      else if (level !== 'base' && !info.levelable) issue(['versions', i, 'level'], 'notLevelable');
    });

    item.versions.forEach((version, i) => {
      const content = contentSchema(item.type, 'final').safeParse(version.content);
      if (!content.success) {
        for (const e of content.error.issues) {
          issue(['versions', i, 'content', ...(e.path as (string | number)[])], problemKey(e));
        }
        return;
      }
      if (!version.answerKey) {
        if (info.keyed || questionsOf(item.type, content.data).length) {
          issue(['versions', i, 'answerKey'], 'required');
        }
        return;
      }
      if (!info.mayHaveQuestions) {
        issue(['versions', i, 'answerKey'], 'notAllowed');
        return;
      }
      const key = answerKeySchema('final').safeParse(version.answerKey);
      if (!key.success) {
        for (const e of key.error.issues) {
          issue(['versions', i, 'answerKey', ...(e.path as (string | number)[])], problemKey(e));
        }
        return;
      }
      for (const e of validateAnswerKey(item.type, content.data, key.data)) {
        issue(['versions', i, e.where === 'key' ? 'answerKey' : 'content', ...e.path], e.code);
      }
    });

    if (info.needsSafety && !item.safetyNotes) issue(['safetyNotes'], 'required');
    if (item.provenance.source === 'ai_generated') {
      if (!item.provenance.promptVersion) issue(['provenance', 'promptVersion'], 'required');
      if (!item.provenance.model) issue(['provenance', 'model'], 'required');
    }
    if (item.faith.onStudentSheet && !item.faith.catholicConnection.trim()) {
      issue(['faith', 'onStudentSheet'], 'noConnection');
    }
    checkUnique(item.gradeCodes, 'gradeCodes', issue);
    checkUnique(item.tags, 'tags', issue);
    checkUnique(
      item.expectations.map((e) => `${e.curriculumVersion} ${e.gradeCode} ${e.code}`),
      'expectations',
      issue,
    );
  });
export type ContentPackItem = z.output<typeof contentPackItemSchema>;

function envelope<T extends z.ZodType>(item: T) {
  return z.strictObject({
    format: z.literal(CONTENT_PACK_FORMAT, { error: 'notAPack' }),
    formatVersion: z.literal(CONTENT_PACK_FORMAT_VERSION, { error: 'formatVersion' }),
    pack: packHeaderSchema,
    /** The exporting board's levels that the versions use. */
    levels: list(packLevelSchema, 0, 50),
    /** The tags the items use; the import creates the missing ones for the board. */
    tags: list(packTagSchema, 0, 500),
    /** The Catholic references the items use. */
    catholicReferences: list(packReferenceSchema, 0, 500),
    items: list(item, 1, PACK_MAX_ITEMS),
    /** `packChecksum(items)`. */
    checksum: z.string({ error: 'invalid' }).regex(SHA256_PATTERN, 'invalid'),
  });
}

/**
 * The whole file. `validatePack` also checks what a schema cannot: hashes, the checksum,
 * unique keys and that every level, tag and reference an item uses is declared.
 */
export const contentPackSchema = envelope(contentPackItemSchema);
/** The file around its items, which `validatePack` checks one by one. */
const packEnvelopeSchema = envelope(z.unknown());
export type ContentPack = z.output<typeof contentPackSchema>;

// ---------------------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------------------

/**
 * JSON with object keys in code-unit order and no white space (the RFC 8785 ordering), so
 * the same value always gives the same text whatever the order its keys were written in.
 * Array order is kept. Undefined object values are left out, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: a number is not finite');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new Error('canonicalJson: only plain objects and arrays are JSON');
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: a ${typeof value} is not JSON`);
  }
}

/** SHA-256 (hex) of an item's canonical JSON, without its own `hash`. */
export function itemHash(item: object): string {
  const { hash: _hash, ...rest } = item as Record<string, unknown>;
  return sha256Hex(canonicalJson(rest));
}

/**
 * SHA-256 (hex) of the lines `<key> <itemHash>`, sorted (code-unit order, so SQL sorts them
 * with `collate "C"`) and joined with `\n`. It ignores the order of the items in the file,
 * and the database can recompute it from staged items' keys and hashes.
 */
export function packChecksum(items: readonly object[]): string {
  const lines = items
    .map((item) => `${String((item as { key?: unknown }).key)} ${itemHash(item)}`)
    .sort();
  return sha256Hex(lines.join('\n'));
}

function versionParts(version: string): [number, number] {
  if (!PACK_VERSION_PATTERN.test(version)) throw new Error(`invalid pack version: ${version}`);
  const [year, n] = version.split('.');
  return [Number(year), Number(n)];
}

/** Negative, zero or positive, like a sort comparator: `2026.10` comes after `2026.9`. */
export function comparePackVersions(a: string, b: string): number {
  const [yearA, nA] = versionParts(a);
  const [yearB, nB] = versionParts(b);
  return yearA - yearB || nA - nB;
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

export interface PackProblem {
  /** Dotted path in the file (`items.3.versions.1.level`); `''` for the file itself. */
  path: string;
  /** An error key (`unknownType`, `notLevelable`, `hashMismatch`…). */
  message: string;
}

export interface PackValidation {
  /** The pack must not be imported while there is one. */
  errors: PackProblem[];
  /** Imported anyway; reported by the CLI's dry run. */
  warnings: PackProblem[];
}

/** A key of this package (`required`, `missingAnswer`…), or `invalid` for Zod's sentences. */
function problemKey(issue: { message: string }): string {
  return /^[a-z][A-Za-z0-9]*$/.test(issue.message) ? issue.message : 'invalid';
}

const joinPath = (path: readonly PropertyKey[]) => path.map(String).join('.');

function zodProblems(error: z.ZodError, prefix: readonly PropertyKey[]): PackProblem[] {
  return error.issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ path: joinPath([...path, key]), message: 'unknownKey' }));
    }
    return [{ path: joinPath(path), message: problemKey(issue) }];
  });
}

/**
 * Everything wrong with a pack file, with dotted paths: the envelope and header, each item
 * (checked on its own, so one bad item doesn't hide the others), each item's hash, the
 * checksum, duplicate keys, and levels, tags and references used but not declared (a level
 * that is not one of the pack's board levels, such as a teacher's personal level, is
 * `unknownLevel`). Warnings: attentes or tags an approval will need, and declarations no item
 * uses (the import would create unused tags).
 */
export function validatePack(input: unknown): PackValidation {
  const errors: PackProblem[] = [];
  const warnings: PackProblem[] = [];
  const error = (path: readonly PropertyKey[], message: string) =>
    errors.push({ path: joinPath(path), message });
  const warn = (path: readonly PropertyKey[], message: string) =>
    warnings.push({ path: joinPath(path), message });

  const outer = packEnvelopeSchema.safeParse(input);
  if (!outer.success) errors.push(...zodProblems(outer.error, []));
  const file = isPlainObject(input) ? input : {};
  const rawItems = Array.isArray(file.items) ? (file.items as unknown[]) : [];

  // The declarations that parse, with their index in the file and the key items use.
  const declarations = <T>(schema: z.ZodType<T>, value: unknown, keyOf: (v: T) => string) =>
    (Array.isArray(value) ? value : []).flatMap((raw: unknown, index) => {
      const parsed = schema.safeParse(raw);
      return parsed.success ? [{ index, key: keyOf(parsed.data) }] : [];
    });
  const referenceKey = (r: PackReference) => `${r.type} ${r.title}`;
  const declared = {
    levels: declarations(packLevelSchema, file.levels, (l) => l.code),
    tags: declarations(packTagSchema, file.tags, (t) => t.slug),
    catholicReferences: declarations(packReferenceSchema, file.catholicReferences, referenceKey),
  };
  const used = {
    levels: new Set<string>(),
    tags: new Set<string>(),
    catholicReferences: new Set<string>(),
  };
  const known = {
    levels: new Set(declared.levels.map((d) => d.key)),
    tags: new Set(declared.tags.map((d) => d.key)),
    catholicReferences: new Set(declared.catholicReferences.map((d) => d.key)),
  };

  const keys = new Set<string>();
  rawItems.forEach((raw, i) => {
    const parsed = contentPackItemSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...zodProblems(parsed.error, ['items', i]));
      return;
    }
    const item = parsed.data;
    if (keys.has(item.key)) error(['items', i, 'key'], 'duplicateKey');
    keys.add(item.key);
    if (item.hash !== itemHash(raw as object)) error(['items', i, 'hash'], 'hashMismatch');

    item.versions.forEach((version, j) => {
      if (version.level === null) return;
      used.levels.add(version.level);
      if (!known.levels.has(version.level)) {
        error(['items', i, 'versions', j, 'level'], 'unknownLevel');
      }
    });
    item.tags.forEach((tag, j) => {
      used.tags.add(tag);
      if (!known.tags.has(tag)) error(['items', i, 'tags', j], 'unknownTag');
    });
    if (item.faith.reference) {
      const key = referenceKey(item.faith.reference);
      used.catholicReferences.add(key);
      if (!known.catholicReferences.has(key)) {
        error(['items', i, 'faith', 'reference'], 'unknownReference');
      }
    }

    if (!TYPE_INFO[item.type].expectationsOptional && !item.expectations.length) {
      warn(['items', i, 'expectations'], 'expectationsMissing');
    }
    if (!item.keywords.trim() && !item.tags.length) warn(['items', i, 'tags'], 'tagsMissing');
  });

  if (rawItems.length && rawItems.every(isPlainObject) && typeof file.checksum === 'string') {
    if (file.checksum !== packChecksum(rawItems)) error(['checksum'], 'checksumMismatch');
  }
  for (const name of ['levels', 'tags', 'catholicReferences'] as const) {
    const seen = new Set<string>();
    for (const { index, key } of declared[name]) {
      if (seen.has(key)) error([name, index], 'duplicate');
      else if (!used[name].has(key)) warn([name, index], 'unused');
      seen.add(key);
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------------------
// From the Phase 4 seed format (`seed-pack.ts`)
// ---------------------------------------------------------------------------------------

/** The levels every board starts with (`provision_board_defaults`). */
export const BOARD_DEFAULT_LEVELS: readonly PackLevel[] = [
  { code: 'debutant', labelFr: 'Débutant', labelEn: 'Beginner' },
  { code: 'intermediaire', labelFr: 'Intermédiaire', labelEn: 'Intermediate' },
  { code: 'avance', labelFr: 'Avancé', labelEn: 'Advanced' },
  { code: 'enrichi', labelFr: 'Enrichi', labelEn: 'Enriched' },
];

/** What a v1 pack needs and the seed format does not say. */
export interface SeedPackOptions {
  /**
   * The curriculum version of each subject's attentes (`{ mat: 'mat-2020' }`): seed items give
   * the grade and code only.
   */
  curriculumVersions: Readonly<Record<string, string>>;
  /** The type of each Catholic reference title the items use: seed items give the title only. */
  referenceTypes: Readonly<Record<string, CatholicReferenceType>>;
  /** The labels of the level codes the versions use. Default: `BOARD_DEFAULT_LEVELS`. */
  levels?: readonly PackLevel[];
  /** `YYYY.N`. Default: the seed pack's version. */
  version?: string;
  /** ISO 8601. Default: now. */
  createdAt?: string;
  /** The pack's licence (at most 500 characters). Default: `''`. */
  licence?: string;
  /** Default: false. */
  noDerivatives?: boolean;
}

/**
 * One seed item as a v1 pack item, keyed by its slug. The versions are canonical like the seed
 * SQL's (`packToSql`), so the hash matches what the seed stores. Authors, schools, workflow
 * state and the sub-friendly flag are not part of a pack.
 */
export function packItemFromSeed(
  item: SeedItem,
  options: Pick<SeedPackOptions, 'curriculumVersions' | 'referenceTypes' | 'noDerivatives'>,
): ContentPackItem {
  if (!PACK_ITEM_KEY_PATTERN.test(item.slug)) throw new Error(`item slug too long: ${item.slug}`);
  const expectations = item.expectations.map((e) => {
    const curriculumVersion = options.curriculumVersions[item.subjectCode];
    if (!curriculumVersion) {
      throw new Error(`no curriculum version for subject ${item.subjectCode} (${item.slug})`);
    }
    return { curriculumVersion, gradeCode: e.grade, code: e.code };
  });
  let reference: PackReference | null = null;
  if (item.catholicReference) {
    const type = options.referenceTypes[item.catholicReference];
    if (!type) {
      throw new Error(`no type for the Catholic reference « ${item.catholicReference} »`);
    }
    reference = { type, title: item.catholicReference };
  }
  const withoutHash: Omit<ContentPackItem, 'hash'> = {
    key: item.slug,
    type: item.type,
    title: item.title,
    summary: item.summary,
    gradeCodes: item.gradeCodes,
    subjectCode: item.subjectCode,
    expectations,
    durationMinutes: item.durationMinutes,
    materials: item.materials,
    keywords: item.keywords,
    formats: item.formats,
    safetyNotes: item.safetyNotes,
    faith: {
      faithContent: item.faithContent,
      catholicConnection: item.catholicConnection,
      reference,
      onStudentSheet: item.faithOnStudentSheet,
    },
    tags: item.tags,
    licence: item.licence ?? '',
    noDerivatives: options.noDerivatives ?? false,
    provenance: { source: item.source, promptVersion: item.promptVersion, model: item.model },
    versions: item.versions.map((v) => ({
      level: v.level,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      content: conform(contentObject(item.type, 'draft'), v.content) as Record<string, unknown>,
      answerKey: v.answerKey
        ? (conform(questionSchemas('draft').answerKey, v.answerKey) as Record<string, unknown>)
        : null,
    })),
  };
  return { ...withoutHash, hash: itemHash(withoutHash) };
}

/**
 * A seed pack folder (`pack.json` and its item files, as parsed JSON) as a v1 pack. Items keep
 * the pack's load order and are keyed by slug; only the levels, tags and references the items
 * use are declared. Throws when the seed is invalid, when its item list and files differ, or
 * when an option is missing for something an item uses.
 */
export function packFromSeedDirectory(
  packInput: unknown,
  itemInputs: readonly unknown[],
  options: SeedPackOptions,
): ContentPack {
  const seed = seedPackSchema.parse(packInput);
  const items = itemInputs.map((raw, i) => {
    const parsed = seedItemSchema.safeParse(raw);
    if (!parsed.success) {
      const slugOf = (raw as { slug?: unknown } | null)?.slug;
      const first = parsed.error.issues[0]!;
      throw new Error(
        `invalid item ${String(slugOf ?? i)} at ${first.path.join('.')}: ${first.message}`,
      );
    }
    return parsed.data;
  });
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  if (bySlug.size !== items.length) throw new Error('duplicate item slug');
  const missing = seed.items.filter((s) => !bySlug.has(s));
  const extra = items.filter((item) => !seed.items.includes(item.slug)).map((item) => item.slug);
  if (missing.length || extra.length) {
    throw new Error(
      `pack items and item files differ: missing ${missing.join(', ') || '—'}; extra ${extra.join(', ') || '—'}`,
    );
  }
  if (!seed.publisher) throw new Error('the seed pack has no publisher');

  const packItems = seed.items.map((s) => packItemFromSeed(bySlug.get(s)!, options));

  const levelCodes = new Set(packItems.flatMap((i) => i.versions.flatMap((v) => v.level ?? [])));
  const levelLabels = options.levels ?? BOARD_DEFAULT_LEVELS;
  for (const code of levelCodes) {
    if (!levelLabels.some((l) => l.code === code)) throw new Error(`no label for level ${code}`);
  }
  const tagSlugs = new Set(packItems.flatMap((i) => i.tags));
  const unknownTag = [...tagSlugs].find((t) => !seed.tags.some((d) => d.slug === t));
  if (unknownTag) throw new Error(`an item uses the undefined tag ${unknownTag}`);
  const references = new Map<string, PackReference>();
  for (const item of packItems) {
    const reference = item.faith.reference;
    if (reference) references.set(`${reference.type} ${reference.title}`, reference);
  }

  return {
    format: CONTENT_PACK_FORMAT,
    formatVersion: CONTENT_PACK_FORMAT_VERSION,
    pack: {
      slug: seed.slug,
      version: options.version ?? seed.version,
      title: seed.title,
      publisher: seed.publisher,
      licence: options.licence ?? '',
      noDerivatives: options.noDerivatives ?? false,
      createdAt: options.createdAt ?? new Date().toISOString(),
      contentSchemaVersion: CURRENT_SCHEMA_VERSION,
    },
    levels: levelLabels.filter((l) => levelCodes.has(l.code)).map((l) => ({ ...l })),
    tags: seed.tags.filter((t) => tagSlugs.has(t.slug)).map((t) => ({ ...t })),
    catholicReferences: [...references.values()],
    items: packItems,
    checksum: packChecksum(packItems),
  };
}
