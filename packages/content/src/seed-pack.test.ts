/**
 * The demo content pack in `content/library/demo` (DECISIONS D-071; plan tests 49–55). The files
 * are checked the way a reviewer would check them, so an item cannot reach the seed with
 * content that fails `final`, a broken answer key, European French, a seed student's first name,
 * missing level versions, missing safety notes or faith content that nobody reviewed. A teacher
 * still reads them (plan J3); the writing rules are in `content/library/README.md`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAnswerKey } from './answer-key';
import { LIBRARY_BUCKETS, TYPE_INFO } from './catalog';
import { questionsOf } from './questions-of';
import { reviewReadiness } from './readiness';
import { docToPlainText } from './render/plain';
import { renderStudentDoc } from './render/student';
import { rubricWordingProblems } from './rubric';
import { safetyNotesComplete } from './safety';
import { answerKeySchema, contentSchema } from './schemas';
import {
  SEED_ITEMS_DIR,
  seedItemFile,
  seedItemRequiresFaithReview,
  seedItemSchema,
  seedPackSchema,
  type SeedItem,
} from './seed-pack';
import { packToSql, seedItemId, seedVersionId } from './seed-sql';
import { frenchStrings, frenchStyleProblems, mapStrings, suggestsFaithContent } from './style';

const repo = new URL('../../../', import.meta.url);
const packDir = new URL('content/library/demo/', repo);
const readText = (url: URL) => readFileSync(url, 'utf8');
const readJson = (url: URL): unknown => JSON.parse(readText(url));

const rawPack = readJson(new URL('pack.json', packDir));
const pack = seedPackSchema.parse(rawPack);

const itemFiles = readdirSync(new URL(`${SEED_ITEMS_DIR}/`, packDir))
  .filter((file) => file.endsWith('.json'))
  .sort();
const loaded = itemFiles.map((file) => {
  const raw = readJson(new URL(`${SEED_ITEMS_DIR}/${file}`, packDir));
  return { file, raw, parsed: seedItemSchema.safeParse(raw) };
});
/** The items that parse (test 49 reports the others), in the pack's load order. */
const items: SeedItem[] = loaded
  .flatMap(({ parsed }) => (parsed.success ? [parsed.data] : []))
  .sort((a, b) => pack.items.indexOf(a.slug) - pack.items.indexOf(b.slug));

const seedSql = readText(new URL('supabase/seed.sql', repo));

/** Seed students' first names, found with the plan's regex (test 55). */
const SEED_STUDENT_NAMES = [
  ...new Set(
    [...seedSql.matchAll(/\('([^']+)', '(avance|enrichi|intermediaire|debutant)'\)/g)].map(
      (m) => m[1]!,
    ),
  ),
];

/** Seeded attentes as `subject grade code`. */
const SEEDED_EXPECTATIONS = new Set(
  [
    ...seedSql.matchAll(
      /\('[0-9a-f-]{36}'::uuid, '([a-z_]+)', '(K1|K2|[1-8])', '[0-9a-f-]{36}'::uuid, (?:null(?:::uuid)?|'[0-9a-f-]{36}'::uuid), '(?:overall|specific)', '([^']+)'/g,
    ),
  ].map((m) => `${m[1]} ${m[2]} ${m[3]}`),
);
/**
 * The four 5e Français attentes the Phase 4 seed adds to `seed.sql` (plan C5), with the same
 * meanings as the 3e codes. Listed here until that change lands; the generated seed's `DO`
 * block raises if one is missing when it loads.
 */
const PLANNED_EXPECTATIONS = ['fra 5 C1', 'fra 5 C1.2', 'fra 5 D1', 'fra 5 D1.1'];

/** The board levels every new board gets (`provision_board_defaults`), with their labels. */
const BOARD_LEVELS = [
  ...readText(new URL('supabase/migrations/20260928160900_reference_data.sql', repo)).matchAll(
    /\(p_board_id, '([a-z_]+)', '([^']+)', '([^']+)',/g,
  ),
].map((m) => ({ code: m[1]!, labelFr: m[2]!, labelEn: m[3]! }));

/** Every string of a JSON value, keys excluded. */
function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

/** Every prose string of a value (ids, kinds and other machine values left out). */
function proseStrings(value: unknown): string[] {
  const strings: string[] = [];
  mapStrings(value, (s) => {
    strings.push(s);
    return s;
  });
  return strings;
}

/** The item's French prose: its own fields, its safety notes, its versions and their keys. */
function frenchTextOf(item: SeedItem): string[] {
  const fields = [
    item.title,
    item.summary,
    item.materials,
    item.keywords,
    item.catholicConnection,
    item.catholicReference ?? '',
    item.licence ?? '',
  ];
  return [
    ...fields,
    ...proseStrings(item.safetyNotes),
    ...item.versions.flatMap((v) => [
      ...frenchStrings(item.type, v.content),
      ...proseStrings(v.answerKey),
    ]),
  ].filter((s) => s.trim() !== '');
}

/** « slug [level] », for failure messages. */
const where = (item: SeedItem, version: SeedItem['versions'][number]) =>
  `${item.slug} [${version.level ?? 'base'}]`;

describe('seed pack (content/library/demo)', () => {
  it('49. every item parses in final mode, its keys validate and its French passes the style checks', () => {
    const problems: string[] = [];
    for (const { file, parsed } of loaded) {
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          problems.push(`${file}: ${issue.path.join('.')}: ${issue.message}`);
        }
        continue;
      }
      const item = parsed.data;
      if (seedItemFile(item.slug) !== `${SEED_ITEMS_DIR}/${file}`) {
        problems.push(`${file}: the file is not named after its slug ${item.slug}`);
      }

      for (const version of item.versions) {
        const at = where(item, version);
        const content = contentSchema(item.type, 'final').safeParse(version.content);
        if (!content.success) {
          problems.push(`${at}: content fails final at ${content.error.issues[0]!.path.join('.')}`);
          continue;
        }
        const needsKey =
          TYPE_INFO[item.type].keyed || questionsOf(item.type, content.data).length > 0;
        if (!version.answerKey) {
          if (needsKey) problems.push(`${at}: no answer key`);
        } else {
          const key = answerKeySchema('final').safeParse(version.answerKey);
          if (!key.success) {
            problems.push(`${at}: key fails final at ${key.error.issues[0]!.path.join('.')}`);
          } else {
            for (const issue of validateAnswerKey(item.type, content.data, key.data)) {
              problems.push(`${at}: key ${issue.code} at ${issue.where} ${issue.path.join('.')}`);
            }
          }
        }
      }

      for (const text of frenchTextOf(item)) {
        for (const problem of frenchStyleProblems(text)) {
          problems.push(`${item.slug}: ${problem.code} « ${problem.match} »`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('50. the pack lists its 29 items once each, every bucket has at least 3, and ids are unique', () => {
    expect(itemFiles).toHaveLength(29);
    expect(items).toHaveLength(29);
    expect(pack.items).toHaveLength(29);
    expect(new Set(pack.items).size).toBe(pack.items.length);
    expect([...pack.items].sort()).toEqual(items.map((i) => i.slug).sort());

    for (const bucket of LIBRARY_BUCKETS) {
      const count = items.filter((i) => TYPE_INFO[i.type].bucket === bucket).length;
      expect(count, bucket).toBeGreaterThanOrEqual(3);
    }

    const ids = items.flatMap((item) => [
      seedItemId(pack.slug, item.slug),
      ...item.versions.map((v) => seedVersionId(pack.slug, item.slug, v.level)),
    ]);
    expect(new Set(ids).size).toBe(ids.length);

    // Tags: defined once each by the pack, and every item's tags among them.
    const tagSlugs = pack.tags.map((t) => t.slug);
    expect(new Set(tagSlugs).size).toBe(tagSlugs.length);
    for (const item of items) {
      for (const tag of item.tags) expect(tagSlugs, item.slug).toContain(tag);
    }
    for (const tag of pack.tags) {
      expect(frenchStyleProblems(tag.labelFr), tag.slug).toEqual([]);
    }

    // The whole pack converts to SQL (the pack and the files agree, no quote tag inside).
    const raws = loaded.map((l) => l.raw);
    expect(() => packToSql(rawPack, raws)).not.toThrow();
  });

  it('51. every attente exists in the seeded curriculum (with the planned 5e Français codes)', () => {
    expect(SEEDED_EXPECTATIONS.size).toBeGreaterThanOrEqual(18);
    expect(SEEDED_EXPECTATIONS).toContain('fra 3 C1.2');
    const known = new Set([...SEEDED_EXPECTATIONS, ...PLANNED_EXPECTATIONS]);
    const problems: string[] = [];
    for (const item of items) {
      for (const e of item.expectations) {
        const key = `${item.subjectCode} ${e.grade} ${e.code}`;
        if (!known.has(key)) problems.push(`${item.slug}: unknown attente ${key}`);
        if (!item.gradeCodes.includes(e.grade)) {
          problems.push(`${item.slug}: attente ${key} is not for one of the item's grades`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('52. approved student sheets that need levels have all four board levels, with one objective', () => {
    expect(BOARD_LEVELS.map((l) => l.code)).toEqual([
      'debutant',
      'intermediaire',
      'avance',
      'enrichi',
    ]);
    const boardCodes = BOARD_LEVELS.map((l) => l.code);
    const levelNames = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${BOARD_LEVELS.flatMap((l) => [l.labelFr, l.labelEn]).join('|')})(?![\\p{L}\\p{N}])`,
      'iu',
    );
    const problems: string[] = [];

    const needLevels = items.filter(
      (i) => i.status === 'board_approved' && TYPE_INFO[i.type].levelsForApproval,
    );
    expect(needLevels.map((i) => i.type).sort()).toEqual([
      'exit_ticket',
      'quiz',
      'reading_passage',
      'reading_passage',
      'worksheet',
      'worksheet',
    ]);
    for (const item of needLevels) {
      const levels = item.versions.flatMap((v) => (v.level ? [v.level] : []));
      expect([...levels].sort(), item.slug).toEqual([...boardCodes].sort());
    }

    for (const item of items) {
      const base = item.versions.find((v) => v.level === null)!;
      const baseContent = base.content as { objective?: string };
      const baseQuestions = questionsOf(item.type, base.content).map(
        (q) => `${q.question.id}:${q.question.kind}`,
      );
      item.versions.forEach((version, index) => {
        const at = where(item, version);
        if (version.level && !boardCodes.includes(version.level)) {
          problems.push(`${at}: not a board level`);
        }
        // Language levels keep the same learning objective (SPEC 10), and assessments keep
        // the same questions and kinds (D-073).
        const content = version.content as { objective?: string };
        if (content.objective !== baseContent.objective) problems.push(`${at}: other objective`);
        if (TYPE_INFO[item.type].keyed) {
          const questions = questionsOf(item.type, version.content).map(
            (q) => `${q.question.id}:${q.question.kind}`,
          );
          if (questions.join() !== baseQuestions.join()) problems.push(`${at}: other questions`);
        }
        // No level name on a student sheet (D-042).
        const doc = renderStudentDoc(item.type, version.content, {
          itemTitle: item.title,
          number: index + 1,
          faith: { connection: item.catholicConnection, onStudentSheet: item.faithOnStudentSheet },
        });
        const match = doc && docToPlainText(doc).match(levelNames);
        if (match) problems.push(`${at}: the student sheet names a level (« ${match[0]} »)`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('53. experiments and STEM challenges carry complete safety notes', () => {
    const withSafety = items.filter((i) => TYPE_INFO[i.type].needsSafety);
    expect(new Set(withSafety.map((i) => i.type))).toEqual(
      new Set(['experiment', 'stem_challenge']),
    );
    for (const item of withSafety) {
      expect(safetyNotesComplete(item.safetyNotes), item.slug).toBe(true);
      // Only what an adult without special training can run safely goes to a substitute.
      if (item.subFriendly) expect(item.safetyNotes?.supervision, item.slug).toBe('standard');
    }
    // Elastic bands are latex-free, and the safety notes (or the materials) say so.
    for (const item of items) {
      if (!allStrings(item).some((s) => /élastique/i.test(s))) continue;
      const said = item.safetyNotes?.allergyAwareMaterials ?? item.materials;
      expect(said, item.slug).toMatch(/sans latex/i);
    }
  });

  it('54. faith content is flagged and faith-reviewed, and rubrics use the achievement chart wording', () => {
    const problems: string[] = [];
    for (const item of items) {
      const faithWords = frenchTextOf(item).filter(suggestsFaithContent);
      if (faithWords.length && !item.faithContent) {
        problems.push(`${item.slug}: faith words but faithContent is false (« ${faithWords[0]} »)`);
      }
      const needsReview = seedItemRequiresFaithReview(item);
      if (item.status === 'board_approved' && needsReview && !item.faithReviewed) {
        problems.push(`${item.slug}: approved faith content without a faith review`);
      }
      if (item.faithReviewed && !needsReview) {
        problems.push(`${item.slug}: faith-reviewed but nothing needs a faith review`);
      }
      if (item.type === 'catholic_reflection' && !item.catholicReference) {
        problems.push(`${item.slug}: a reflection is tied to a Catholic reference`);
      }
    }
    expect(problems).toEqual([]);
    expect(items.some((i) => i.type === 'catholic_reflection' && i.faithReviewed)).toBe(true);

    const rubrics = items.filter((i) => i.type === 'rubric');
    expect(rubrics.length).toBeGreaterThan(0);
    for (const item of rubrics) {
      for (const version of item.versions) {
        const content = contentSchema('rubric', 'final').parse(version.content);
        expect(rubricWordingProblems(content), where(item, version)).toEqual([]);
      }
    }
  });

  it('55. no text holds a seed student’s first name or a quote tag of the generated SQL', () => {
    expect(SEED_STUDENT_NAMES.length).toBeGreaterThanOrEqual(20);
    expect(SEED_STUDENT_NAMES).toEqual(expect.arrayContaining(['Samuel', 'Adam', 'Aïcha']));
    // Whole words with their capital, like a name in a sentence (« olivier » is a tree).
    const names = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${SEED_STUDENT_NAMES.join('|')})(?![\\p{L}\\p{N}])`,
      'u',
    );
    const problems: string[] = [];
    for (const { file, raw } of loaded) {
      for (const text of allStrings(raw)) {
        const name = text.match(names);
        if (name) problems.push(`${file}: seed student name « ${name[0]} »`);
        if (/\$lynx[a-z]*\$/.test(text)) problems.push(`${file}: SQL quote tag`);
      }
    }
    for (const text of allStrings(rawPack)) {
      if (names.test(text) || /\$lynx[a-z]*\$/.test(text)) problems.push(`pack.json: « ${text} »`);
    }
    expect(problems).toEqual([]);
  });

  it('reviewed and approved items are ready for review, and approved ones for approval (D-067)', () => {
    const boardLevelIds = BOARD_LEVELS.map((l) => l.code);
    const problems: string[] = [];
    for (const item of items.filter((i) => i.status !== 'draft')) {
      const readiness = reviewReadiness({
        item: {
          type: item.type,
          gradeCodes: item.gradeCodes,
          subjectId: item.subjectCode,
          durationMinutes: item.durationMinutes,
          materials: item.materials,
          keywords: item.keywords,
          tagIds: item.tags,
          expectationIds: item.expectations.map((e) => `${e.grade} ${e.code}`),
          safetyNotes: item.safetyNotes,
          subFriendly: item.subFriendly,
        },
        versions: item.versions.map((v) => ({
          languageLevelId: v.level,
          content: v.content,
          answerKey: v.answerKey,
        })),
        boardLevelIds,
        forApproval: item.status === 'board_approved',
      });
      for (const issue of readiness.blocking) problems.push(`${item.slug}: blocking ${issue.code}`);
      // « Version de base seulement » is expected; a missing sample answer or substitute notes
      // are not, in a demo.
      for (const issue of readiness.warnings.filter((w) => w.code !== 'baseOnly')) {
        problems.push(`${item.slug}: warning ${issue.code} ${issue.questionId ?? ''}`.trim());
      }
    }
    expect(problems).toEqual([]);
  });
});
