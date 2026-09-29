/**
 * The demo content pack in `content/library/demo` (DECISIONS D-071; plan tests 49–55). The files
 * are checked the way a reviewer would check them, so an item cannot reach the seed with
 * content that fails `final`, a broken answer key, European French, a seed student's first name,
 * missing level versions, missing safety notes or faith content that nobody reviewed. A teacher
 * still reads them (plan J3); the writing rules are in `content/library/README.md`.
 *
 * The curriculum sample in `content/curriculum` is checked here too: the items link to its
 * attentes, so its files must parse and keep every seeded code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAnswerKey } from './answer-key';
import { LIBRARY_BUCKETS, TYPE_INFO } from './catalog';
import { parseCurriculumFile } from './curriculum-import';
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
import type { CatholicReferenceType } from './pack-format';
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

/** Seeded strands (`seed.sql`), by id. */
const SEEDED_STRANDS = new Map(
  [
    ...seedSql.matchAll(
      /\('([0-9a-f-]{36})'::uuid, '([a-z_]+)', '([A-Z])', '((?:[^']|'')+)', '([a-z0-9-]+)', (\d+)\)/g,
    ),
  ].map((m) => [m[1]!, { code: m[3]!, label: m[4]!.replace(/''/g, "'"), sortOrder: Number(m[6]) }]),
);

/** Seeded attentes (`seed.sql`), with their strand and parent as codes. */
const SEEDED_ROWS = (() => {
  const rows = [
    ...seedSql.matchAll(
      /\('([0-9a-f-]{36})'::uuid, '([a-z_]+)', '(K1|K2|[1-8])', '([0-9a-f-]{36})'::uuid, (?:null(?:::uuid)?|'([0-9a-f-]{36})'::uuid), '(overall|specific)', '([^']+)', '((?:[^']|'')+)', '([a-z0-9-]+)', \d+\)/g,
    ),
  ].map((m) => ({
    id: m[1]!,
    subject: m[2]!,
    grade: m[3]!,
    strandId: m[4]!,
    parentId: m[5] ?? null,
    kind: m[6]!,
    code: m[7]!,
    text: m[8]!.replace(/''/g, "'"),
    version: m[9]!,
  }));
  const codeOf = new Map(rows.map((r) => [r.id, r.code]));
  return rows.map((r) => ({
    ...r,
    strandCode: SEEDED_STRANDS.get(r.strandId)?.code ?? null,
    parentCode: r.parentId ? (codeOf.get(r.parentId) ?? null) : null,
  }));
})();

/**
 * What `packToSql` needs for the items' pack hashes (D-100): each subject's curriculum version
 * and each Catholic reference's type, as `seed.sql` has them.
 */
const HASH_OPTIONS = {
  curriculumVersions: Object.fromEntries(SEEDED_ROWS.map((r) => [r.subject, r.version])),
  referenceTypes: Object.fromEntries(
    [
      ...seedSql.matchAll(
        /\('[0-9a-f-]{36}', '(virtue|graduate_expectation|reflection|prayer|scripture)', '((?:[^']|'')*)'/g,
      ),
    ].map((m) => [m[2]!.replace(/''/g, "'"), m[1] as CatholicReferenceType]),
  ),
};

/** Seeded attentes as `subject grade code`. */
const SEEDED_EXPECTATIONS = new Set(SEEDED_ROWS.map((r) => `${r.subject} ${r.grade} ${r.code}`));
/**
 * The four 5e Français attentes `seed.sql` has for the demo library (D-071), with the same
 * meanings as the 3e codes. The generated seed's `DO` block also raises if one is missing.
 */
const LIBRARY_EXPECTATIONS = ['fra 5 C1', 'fra 5 C1.2', 'fra 5 D1', 'fra 5 D1.1'];

/**
 * The curriculum sample (`content/curriculum/*.json`, D-030): paraphrased attentes for 3e and 5e.
 * `pnpm library:seed` turns it into `supabase/seeds/10_curriculum_demo.sql`, which the demo
 * database loads after `seed.sql` and before the library pack (`20_…`), so items may link to its
 * attentes. Parsed without `confirmLicence`, so a file that says it holds official or verified
 * text fails.
 */
const curriculumDir = new URL('content/curriculum/', repo);
const curriculumFiles = readdirSync(curriculumDir)
  .filter((file) => file.endsWith('.json'))
  .sort();
const curricula = curriculumFiles.map((file) => ({
  file,
  ...parseCurriculumFile(readText(new URL(file, curriculumDir))),
}));
/** The curriculum files' attentes as `subject grade code`. */
const CURRICULUM_EXPECTATIONS = new Set(
  curricula.flatMap(({ data }) =>
    data ? data.expectations.map((e) => `${data.subjectCode} ${e.grade} ${e.code}`) : [],
  ),
);

/**
 * A text with its typography undone (’ to ', non-breaking spaces to spaces): the curriculum
 * files may differ from `seed.sql` in typography only.
 */
const plainTypography = (text: string) =>
  text.replace(/[’‘]/g, "'").replace(/[\u00a0\u202f]/g, ' ');

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

  it('50. the pack lists its 78 items once each, every bucket has at least 3, and ids are unique', () => {
    expect(itemFiles).toHaveLength(78);
    expect(items).toHaveLength(78);
    expect(pack.items).toHaveLength(78);
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
    expect(() => packToSql(rawPack, raws, HASH_OPTIONS)).not.toThrow();
  });

  it('51. every attente exists in the seeded curriculum or the curriculum files', () => {
    expect(SEEDED_EXPECTATIONS.size).toBeGreaterThanOrEqual(22);
    expect(SEEDED_EXPECTATIONS).toContain('fra 3 C1.2');
    for (const code of LIBRARY_EXPECTATIONS) expect(SEEDED_EXPECTATIONS).toContain(code);
    expect(CURRICULUM_EXPECTATIONS).toContain('mat 5 E2.5');
    const known = new Set([...SEEDED_EXPECTATIONS, ...CURRICULUM_EXPECTATIONS]);
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

  it('the curriculum files parse, one subject and grade each, and keep every seeded attente', () => {
    expect(curriculumFiles.length).toBeGreaterThan(0);
    const problems: string[] = [];
    const strandsByVersion = new Map<string, string>();
    const subjectGrades = new Set<string>();
    for (const { file, data, errors } of curricula) {
      for (const error of errors) problems.push(`${file}: ${error.path}: ${error.message}`);
      if (!data) continue;

      // One subject and grade per file, named after them (`mat-2020-3e.json`).
      const grades = [...new Set(data.expectations.map((e) => e.grade))];
      const grade = grades[0]!;
      if (grades.length !== 1) problems.push(`${file}: more than one grade (${grades.join(', ')})`);
      const expected = `${data.curriculumVersion}-${grade === '1' ? '1re' : `${grade}e`}.json`;
      if (file !== expected) problems.push(`${file}: expected the name ${expected}`);
      if (!data.curriculumVersion.startsWith(`${data.subjectCode}-`)) {
        problems.push(`${file}: version ${data.curriculumVersion} is not for ${data.subjectCode}`);
      }
      const subjectGrade = `${data.subjectCode} ${grade}`;
      if (subjectGrades.has(subjectGrade)) problems.push(`${file}: second file for the grade`);
      subjectGrades.add(subjectGrade);

      // Both grades of a subject version list the same strands, with the same labels.
      const strands = JSON.stringify(data.strands);
      const other = strandsByVersion.get(data.curriculumVersion);
      if (other !== undefined && other !== strands) problems.push(`${file}: other strands`);
      strandsByVersion.set(data.curriculumVersion, strands);

      const french = [
        data.sourceNote ?? '',
        ...data.strands.map((s) => s.labelFr),
        ...data.expectations.map((e) => e.textFr),
      ];
      for (const text of french) {
        for (const problem of frenchStyleProblems(text)) {
          problems.push(`${file}: ${problem.code} « ${problem.match} »`);
        }
      }
    }
    // A superset of the seed: the files never drop, renumber or reword a seeded attente. The
    // curriculum seed keeps the seeded rows as they are (only their sort order follows the
    // files), so a file that disagreed would show another text than the database.
    expect(SEEDED_ROWS.length).toBe(SEEDED_EXPECTATIONS.size);
    for (const row of SEEDED_ROWS) {
      const key = `${row.subject} ${row.grade} ${row.code}`;
      const found = curricula.find(
        ({ data }) =>
          data?.subjectCode === row.subject &&
          data.curriculumVersion === row.version &&
          data.expectations.some((e) => e.grade === row.grade),
      );
      const entry = found?.data?.expectations.find(
        (e) => e.grade === row.grade && e.code === row.code,
      );
      if (!found?.data || !entry) {
        problems.push(`no curriculum file has ${key} (${row.version})`);
        continue;
      }
      const inFile = [entry.kind, entry.strandCode, entry.parentCode].join(' ');
      const inSeed = [row.kind, row.strandCode, row.parentCode].join(' ');
      if (inFile !== inSeed) problems.push(`${key}: ${inFile} in the file, ${inSeed} in seed.sql`);
      if (plainTypography(entry.textFr) !== plainTypography(row.text)) {
        problems.push(`${key}: other wording than seed.sql`);
      }
      // Its strand: the same label and position as in the seed.
      const seeded = SEEDED_STRANDS.get(row.strandId)!;
      const position = found.data.strands.findIndex((s) => s.code === row.strandCode);
      const strand = found.data.strands[position];
      if (!strand || plainTypography(strand.labelFr) !== plainTypography(seeded.label)) {
        problems.push(`${key}: strand ${row.strandCode} is labelled otherwise in seed.sql`);
      }
      if (position + 1 !== seeded.sortOrder) problems.push(`${key}: strand in another position`);
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
    const needLevelsByType: Record<string, number> = {};
    for (const item of needLevels) {
      needLevelsByType[item.type] = (needLevelsByType[item.type] ?? 0) + 1;
    }
    expect(needLevelsByType).toEqual({
      exit_ticket: 3,
      quiz: 3,
      reading_passage: 7,
      worksheet: 5,
    });
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
