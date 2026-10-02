/**
 * Content pack format v1 (Phase 5 plan D.1, test C4): the real demo seed directory converts to
 * a valid pack, hashes ignore key order, one changed character is caught, and each kind of
 * problem is reported with its path.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOARD_DEFAULT_LEVELS,
  canonicalJson,
  comparePackVersions,
  CONTENT_PACK_FORMAT,
  contentPackSchema,
  itemHash,
  packChecksum,
  packFromSeedDirectory,
  validatePack,
  type CatholicReferenceType,
  type ContentPack,
  type SeedPackOptions,
} from './pack-format';
import { SEED_ITEMS_DIR, seedPackSchema } from './seed-pack';
import { sha256Hex } from './sha256';

const repo = new URL('../../../', import.meta.url);
const packDir = new URL('content/library/demo/', repo);
const readText = (url: URL) => readFileSync(url, 'utf8');
const readJson = (url: URL): unknown => JSON.parse(readText(url));

const rawPack = readJson(new URL('pack.json', packDir));
const rawItems = readdirSync(new URL(`${SEED_ITEMS_DIR}/`, packDir))
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => readJson(new URL(`${SEED_ITEMS_DIR}/${file}`, packDir)));

const seedSql = readText(new URL('supabase/seed.sql', repo));
const unquote = (sql: string) => sql.replace(/''/g, "'");

/** The seeded curriculum version of each subject, from the strands of `seed.sql`. */
const CURRICULUM_VERSIONS: Record<string, string> = {};
for (const m of seedSql.matchAll(
  /\('[0-9a-f-]{36}'::uuid, '([a-z_]+)', '[A-Z0-9]+', '(?:[^']|'')*', '([a-z_]+-\d{4})', \d+\)/g,
)) {
  CURRICULUM_VERSIONS[m[1]!] = m[2]!;
}

/** The seeded Catholic references' types, by title. */
const REFERENCE_TYPES: Record<string, CatholicReferenceType> = Object.fromEntries(
  [
    ...seedSql.matchAll(
      /\('[0-9a-f-]{36}', '(virtue|graduate_expectation|reflection|prayer|scripture)', '((?:[^']|'')*)'/g,
    ),
  ].map((m) => [unquote(m[2]!), m[1] as CatholicReferenceType]),
);

const options: SeedPackOptions = {
  curriculumVersions: CURRICULUM_VERSIONS,
  referenceTypes: REFERENCE_TYPES,
  createdAt: '2026-11-01T12:00:00.000Z',
  licence: 'Ressources de démonstration, usage interne.',
};

const demo = (): ContentPack => packFromSeedDirectory(rawPack, rawItems, options);
/** The file as the CLI reads it. */
const asFile = (pack: unknown): Record<string, unknown> & { items: Record<string, unknown>[] } =>
  JSON.parse(JSON.stringify(pack)) as Record<string, unknown> & {
    items: Record<string, unknown>[];
  };

/** Recomputes every item hash and the checksum after an edit, as an exporter would. */
function rehash(file: Record<string, unknown> & { items: Record<string, unknown>[] }) {
  for (const item of file.items) item.hash = itemHash(item);
  file.checksum = packChecksum(file.items);
  return file;
}

/** A deep copy with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
}

describe('content pack format', () => {
  it('C4. the demo seed directory converts to a valid v1 pack', () => {
    // The facts read from the seed are the ones the demo needs.
    expect(CURRICULUM_VERSIONS).toMatchObject({
      fra: 'fra-2023',
      mat: 'mat-2020',
      sci: 'sci-2022',
    });
    expect(REFERENCE_TYPES['Prendre soin de la création']).toBe('reflection');
    expect(REFERENCE_TYPES['Prière de l’Avent']).toBe('prayer');

    const pack = demo();
    const seed = seedPackSchema.parse(rawPack);
    expect(pack.format).toBe(CONTENT_PACK_FORMAT);
    expect(pack.pack).toMatchObject({
      slug: 'demo',
      version: '2026.1',
      publisher: 'IP Lynx',
      contentSchemaVersion: 1,
    });
    expect(pack.items.map((i) => i.key)).toEqual(seed.items);
    expect(pack.items).toHaveLength(81);
    expect(pack.levels.map((l) => l.code)).toEqual(BOARD_DEFAULT_LEVELS.map((l) => l.code));
    expect(pack.catholicReferences).toEqual([
      { type: 'reflection', title: 'Prendre soin de la création' },
      { type: 'virtue', title: 'La compassion' },
      { type: 'virtue', title: 'La persévérance' },
    ]);
    // No user, school or workflow data travels in a pack.
    const json = JSON.stringify(pack);
    expect(json).not.toMatch(/@demo\.lynx\.test|"author"|"school"|"approvedBy"|"status"/);

    expect(contentPackSchema.safeParse(pack).error?.issues ?? []).toEqual([]);
    expect(validatePack(pack)).toEqual({ errors: [], warnings: [] });
    // As a file, too, and the same seed always gives the same pack.
    expect(validatePack(asFile(pack))).toEqual({ errors: [], warnings: [] });
    expect(demo()).toEqual(pack);
    expect(
      packFromSeedDirectory(rawPack, rawItems, { ...options, version: '2026.2' }).checksum,
    ).toBe(pack.checksum);
  });

  it('C5b. the demo seed records the hash `pnpm library:pack` gives each item (D-100)', () => {
    // So importing the demo pack into a seeded board finds every item unchanged.
    const seed = readText(new URL('supabase/seeds/20_library_demo.sql', repo));
    const recorded = new Map(
      [...seed.matchAll(/'demo', '([a-z0-9-]+)', '([0-9a-f]{64})', 1\);/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    const pack = demo();
    expect(recorded.size).toBe(pack.items.length);
    for (const item of pack.items) expect(recorded.get(item.key), item.key).toBe(item.hash);
  });

  it('C4b. the board default levels are those every board gets', () => {
    const migration = readText(
      new URL('supabase/migrations/20260928160900_reference_data.sql', repo),
    );
    const levels = [...migration.matchAll(/\(p_board_id, '([a-z_]+)', '([^']+)', '([^']+)',/g)].map(
      (m) => ({ code: m[1]!, labelFr: m[2]!, labelEn: m[3]! }),
    );
    expect(levels).toEqual(BOARD_DEFAULT_LEVELS);
  });

  it('C4c. the conversion refuses what a pack cannot say', () => {
    expect(() =>
      packFromSeedDirectory(rawPack, rawItems, { ...options, curriculumVersions: {} }),
    ).toThrow(/no curriculum version/);
    expect(() =>
      packFromSeedDirectory(rawPack, rawItems, { ...options, referenceTypes: {} }),
    ).toThrow(/Catholic reference/);
    expect(() => packFromSeedDirectory(rawPack, rawItems.slice(1), options)).toThrow(/differ/);
    expect(() =>
      packFromSeedDirectory(rawPack, rawItems, {
        ...options,
        levels: BOARD_DEFAULT_LEVELS.slice(1),
      }),
    ).toThrow(/no label for level debutant/);
  });

  it('C4d. itemHash is stable under key order; one changed character changes the checksum', () => {
    const pack = demo();
    for (const item of pack.items) {
      expect(itemHash(item)).toBe(item.hash);
      expect(itemHash(reverseKeys(item) as object)).toBe(item.hash);
    }
    expect(canonicalJson(reverseKeys(pack))).toBe(canonicalJson(pack));
    // The item order in the file does not matter either.
    expect(packChecksum([...pack.items].reverse())).toBe(pack.checksum);

    const file = asFile(pack);
    const version = (file.items[0]!.versions as { content: { title: string } }[])[0]!;
    version.content.title = `${version.content.title}x`;
    expect(packChecksum(file.items)).not.toBe(pack.checksum);
    expect(itemHash(file.items[0]!)).not.toBe(pack.items[0]!.hash);
    expect(validatePack(file).errors).toEqual([
      { path: 'items.0.hash', message: 'hashMismatch' },
      { path: 'checksum', message: 'checksumMismatch' },
    ]);
    // The exporter's own hashes make it whole again.
    expect(validatePack(rehash(file)).errors).toEqual([]);
  });

  it('C4e. a bad version, an unknown type, a level on a type without levels and a personal level are reported with their path', () => {
    const file = asFile(demo());
    const index = (key: string) => file.items.findIndex((i) => i.key === key);
    (file.pack as Record<string, unknown>).version = '2026';

    const podcast = index('huard-oiseau-des-lacs');
    file.items[podcast]!.type = 'podcast';

    const brainBreak = index('pause-jeu-du-miroir');
    const versions = file.items[brainBreak]!.versions as Record<string, unknown>[];
    versions.push({ ...versions[0]!, level: 'debutant' });

    const quiz = index('quiz-nombres-1000');
    const quizVersions = file.items[quiz]!.versions as Record<string, unknown>[];
    expect(quizVersions.length).toBeGreaterThan(1);
    quizVersions[1]!.level = 'perso_isabelle';

    const { errors } = validatePack(rehash(file));
    const expected = [
      { path: 'pack.version', message: 'invalid' },
      { path: `items.${podcast}.type`, message: 'unknownType' },
      { path: `items.${brainBreak}.versions.1.level`, message: 'notLevelable' },
      { path: `items.${quiz}.versions.1.level`, message: 'unknownLevel' },
    ];
    expect(errors).toHaveLength(expected.length);
    expect(errors).toEqual(expect.arrayContaining(expected));
  });

  it('C4f. validatePack checks the file around the items', () => {
    expect(validatePack(null).errors[0]).toEqual({ path: '', message: 'invalid' });
    const file = asFile(demo());
    file.format = 'autre-chose';
    file.items[0]!.secret = 'x';
    const item = file.items[1]!;
    (file.items as unknown[]).push({ ...item });
    (file.tags as unknown[]).push({ slug: 'jamais-utilise', labelFr: 'Jamais utilisé' });
    const quiz = file.items.findIndex((i) => i.type === 'quiz');
    file.items[quiz]!.expectations = [];
    const { errors, warnings } = validatePack(rehash(file));
    expect(errors).toEqual([
      { path: 'format', message: 'notAPack' },
      { path: 'items.0.secret', message: 'unknownKey' },
      { path: `items.${file.items.length - 1}.key`, message: 'duplicateKey' },
    ]);
    expect(warnings).toEqual([
      { path: `items.${quiz}.expectations`, message: 'expectationsMissing' },
      { path: `tags.${(file.tags as unknown[]).length - 1}`, message: 'unused' },
    ]);

    // Undeclared tags and references are errors.
    const other = asFile(demo());
    other.tags = [];
    other.catholicReferences = [];
    const reflection = other.items.findIndex((i) => i.type === 'catholic_reflection');
    const problems = validatePack(rehash(other)).errors;
    expect(problems).toContainEqual({ path: 'items.0.tags.0', message: 'unknownTag' });
    expect(problems).toContainEqual({
      path: `items.${reflection}.faith.reference`,
      message: 'unknownReference',
    });
  });

  it('C4g. content, keys and safety notes are checked like a reviewed item', () => {
    const file = asFile(demo());
    const experiment = file.items.findIndex((i) => i.type === 'experiment');
    file.items[experiment]!.safetyNotes = null;
    const quiz = file.items.findIndex((i) => i.type === 'quiz');
    const base = (
      file.items[quiz]!.versions as { content: Record<string, unknown>; answerKey: unknown }[]
    )[0]!;
    base.answerKey = { answers: [], solution: '' };
    const { errors } = validatePack(rehash(file));
    expect(errors).toContainEqual({ path: `items.${experiment}.safetyNotes`, message: 'required' });
    expect(errors).toContainEqual({
      path: `items.${quiz}.versions.0.answerKey.answers`,
      message: 'missingAnswer',
    });
  });

  it('C4h. comparePackVersions orders YYYY.N numerically', () => {
    expect(comparePackVersions('2026.10', '2026.9')).toBeGreaterThan(0);
    expect(comparePackVersions('2026.2', '2026.2')).toBe(0);
    expect(comparePackVersions('2025.12', '2026.1')).toBeLessThan(0);
    expect(['2026.10', '2025.3', '2026.9'].sort(comparePackVersions)).toEqual([
      '2025.3',
      '2026.9',
      '2026.10',
    ]);
    expect(() => comparePackVersions('2026.01', '2026.1')).toThrow(/invalid pack version/);
    expect(() => comparePackVersions('v2', '2026.1')).toThrow(/invalid pack version/);
  });

  it('C4i. canonicalJson and SHA-256', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }], e: undefined, f: 'é' })).toBe(
      '{"a":[{"c":null,"d":2}],"b":1,"f":"é"}',
    );
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ d: new Date(0) })).toThrow();
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // Every padding case, with multi-byte characters.
    for (let n = 0; n < 200; n++) {
      const text = 'é’«x»🍁'.repeat(n).slice(0, n);
      expect(sha256Hex(text), String(n)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
});
