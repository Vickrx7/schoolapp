/**
 * Content packs from a board's export (Phase 5 plan D.1, test C4; DECISIONS D-099, D-100): the
 * database's export rows become valid v1 pack items with stable hashes, a pack declares only what
 * its items use, and the texts the CLI checks for first names and faith words.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assemblePack,
  BOARD_DEFAULT_LEVELS,
  contentPackItemSchema,
  itemHash,
  packChecksum,
  packExportPageSchema,
  packItemFromExport,
  packItemFromSeed,
  packItemSuggestsFaith,
  packItemTexts,
  packTagsFromExport,
  validatePack,
  type ContentPackItem,
  type PackExportRow,
  type PackHeader,
} from './pack-format';
import { seedItemSchema, type SeedItem } from './seed-pack';

const itemsDir = new URL('../../../content/library/demo/items/', import.meta.url);
const seedItem = (slug: string): SeedItem =>
  seedItemSchema.parse(JSON.parse(readFileSync(new URL(`${slug}.json`, itemsDir), 'utf8')));

const OPTIONS = {
  curriculumVersions: { fra: 'fra-2023', mat: 'mat-2020', sci: 'sci-2022' },
  referenceTypes: {
    'Prendre soin de la création': 'reflection',
    'La compassion': 'virtue',
    'La persévérance': 'virtue',
  },
} as const;

const TAG_LABELS: Record<string, string> = {
  nombres: 'Nombres',
  evaluation: 'Évaluation',
  foi: 'Foi',
  creation: 'Création',
  priere: 'Prière',
  sciences: 'Sciences',
};

/** A pack item as `public.content_pack_export_items` would return it (nulls, labelled tags). */
function asExportRow(item: ContentPackItem): PackExportRow {
  const orNull = (s: string) => (s === '' ? null : s);
  return {
    key: item.key,
    type: item.type,
    title: item.title,
    summary: orNull(item.summary),
    gradeCodes: item.gradeCodes,
    subjectCode: item.subjectCode,
    expectations: item.expectations,
    durationMinutes: item.durationMinutes,
    materials: orNull(item.materials),
    keywords: orNull(item.keywords),
    formats: item.formats,
    safetyNotes: item.safetyNotes as Record<string, unknown> | null,
    faith: { ...item.faith, catholicConnection: orNull(item.faith.catholicConnection) },
    tags: item.tags.map((slug) => ({ slug, label: TAG_LABELS[slug] ?? slug })),
    licence: orNull(item.licence),
    noDerivatives: item.noDerivatives,
    provenance: item.provenance,
    versions: item.versions.map((v) => ({ ...v, content: { ...v.content } })),
  } as PackExportRow;
}

const HEADER: PackHeader = {
  slug: 'demo',
  version: '2026.2',
  title: 'Ressources de démonstration',
  publisher: 'IP Lynx',
  licence: 'Usage interne du conseil.',
  noDerivatives: false,
  createdAt: '2026-11-01T12:00:00.000Z',
  contentSchemaVersion: 1,
};

describe('packs from a board’s export', () => {
  it('C4j. an exported item is the pack item the seed gives, with the same hash', () => {
    // Exporting a seeded item again under its pack's slug keeps its key and hash.
    for (const slug of ['quiz-nombres-1000', 'eponges-elastiques', 'prendre-soin-de-la-creation']) {
      const fromSeed = packItemFromSeed(seedItem(slug), OPTIONS);
      const fromExport = packItemFromExport(asExportRow(fromSeed));
      expect(fromExport, slug).toEqual(fromSeed);
      expect(contentPackItemSchema.safeParse(fromExport).error?.issues ?? [], slug).toEqual([]);
    }
  });

  it('C4k. nulls become empty strings, tags slugs, and the pack’s « no derivatives » is added', () => {
    const row = asExportRow(packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS));
    const item = packItemFromExport(
      { ...row, summary: null, keywords: null, licence: null },
      { noDerivatives: true },
    );
    expect(item).toMatchObject({
      summary: '',
      keywords: '',
      licence: '',
      noDerivatives: true,
      tags: ['nombres', 'evaluation'],
    });
    expect(item.hash).toBe(itemHash(item));
    // Unknown keys in stored content are dropped, as the seed drops them; the order of keys does
    // not change the hash.
    const noisy = structuredClone(row);
    noisy.versions[0]!.content = Object.fromEntries(
      Object.entries({ ...noisy.versions[0]!.content, extra: 'x' }).reverse(),
    );
    expect(packItemFromExport(noisy).hash).toBe(packItemFromExport(row).hash);
  });

  it('C4l. an item the database cannot describe fails the schema instead of entering the pack', () => {
    const row = asExportRow(packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS));
    const bad = packItemFromExport({ ...row, type: 'podcast', durationMinutes: 900 });
    const issues = contentPackItemSchema.safeParse(bad).error?.issues.map((i) => i.path.join('.'));
    expect(issues).toEqual(expect.arrayContaining(['type', 'durationMinutes']));
  });

  it('C4m. assemblePack declares only the levels, tags and references its items use', () => {
    const rows = ['quiz-nombres-1000', 'prendre-soin-de-la-creation', 'pause-jeu-du-miroir'].map(
      (slug) => asExportRow(packItemFromSeed(seedItem(slug), OPTIONS)),
    );
    const items = rows.map((row) => packItemFromExport(row));
    const pack = assemblePack({
      header: HEADER,
      levels: [
        ...BOARD_DEFAULT_LEVELS,
        { code: 'jamais', labelFr: 'Jamais', labelEn: null },
        { code: 'debutant', labelFr: 'Doublon', labelEn: null },
      ],
      tags: [
        ...packTagsFromExport(rows),
        { slug: 'orpheline', labelFr: 'Orpheline' },
        { slug: 'nombres', labelFr: 'Doublon' },
      ],
      items,
    });
    // Each once: the first declaration wins.
    expect(pack.levels).toEqual(BOARD_DEFAULT_LEVELS);
    expect(pack.tags.find((t) => t.slug === 'nombres')?.labelFr).toBe('Nombres');
    // In order of first use; the tag no item uses is left out.
    expect(pack.tags.map((t) => t.slug)).toEqual([
      ...new Set(rows.flatMap((r) => r.tags.map((t) => t.slug))),
    ]);
    expect(pack.catholicReferences).toEqual([
      { type: 'reflection', title: 'Prendre soin de la création' },
    ]);
    expect(pack.checksum).toBe(packChecksum(items));
    expect(validatePack(pack)).toEqual({ errors: [], warnings: [] });
    expect(validatePack(JSON.parse(JSON.stringify(pack)))).toEqual({ errors: [], warnings: [] });
  });

  it('C4n. packTagsFromExport keeps each tag once, with its label', () => {
    const rows = ['quiz-nombres-1000', 'quiz-nombres-1000'].map((slug) =>
      asExportRow(packItemFromSeed(seedItem(slug), OPTIONS)),
    );
    expect(packTagsFromExport(rows)).toEqual([
      { slug: 'nombres', labelFr: 'Nombres' },
      { slug: 'evaluation', labelFr: 'Évaluation' },
    ]);
  });

  it('C4o. the texts checked for first names: prose of every field, content and key, not machine values', () => {
    const item = packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS);
    const texts = packItemTexts(item);
    expect(texts).toContain(item.title);
    expect(texts).toContain(item.materials);
    expect(texts).toContain('Quel nombre a 4 centaines, 0 dizaine et 7 unités?');
    // Key explanations are prose too; ids, kinds and categories are not.
    const key = item.versions[0]!.answerKey as { answers: { explanation?: string }[] };
    const explanation = key.answers.find((a) => a.explanation)?.explanation;
    expect(explanation).toBeTruthy();
    expect(texts).toContain(explanation);
    for (const machine of ['q1', 'multiple_choice', 'connaissance']) {
      expect(texts).not.toContain(machine);
    }
    expect(texts.every((t) => t.trim() !== '')).toBe(true);
  });

  it('C4p. faith words in an item’s French text make it faith content on import', () => {
    expect(
      packItemSuggestsFaith(packItemFromSeed(seedItem('prendre-soin-de-la-creation'), OPTIONS)),
    ).toBe(true);
    expect(packItemSuggestsFaith(packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS))).toBe(
      false,
    );
    const quiz = packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS);
    expect(packItemSuggestsFaith({ ...quiz, summary: 'Avant la prière du matin.' })).toBe(true);
  });

  it('C4q. an export page is parsed as the database returns it', () => {
    const row = asExportRow(packItemFromSeed(seedItem('quiz-nombres-1000'), OPTIONS));
    const page = packExportPageSchema.parse(
      JSON.parse(JSON.stringify({ items: [row], next: null, levels: BOARD_DEFAULT_LEVELS })),
    );
    expect(page.items[0]).toEqual(row);
    expect(packExportPageSchema.safeParse({ items: [{ key: 'x' }], next: null }).success).toBe(
      false,
    );
  });
});
