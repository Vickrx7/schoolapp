/**
 * Integration test for the demo library seed and the curriculum sample it links to (DECISIONS
 * D-030, D-071; plan H3 tests 1–2). Needs a migrated and seeded database (DATABASE_URL), e.g.
 * after `tools/lite-stack/stack.sh reset` or `supabase db reset`. The seeded attentes and items
 * must exist, so this also proves that the reset loaded `supabase/seeds/*.sql` after `seed.sql`,
 * the curriculum (`10_…`) before the library (`20_…`) (config.toml `sql_paths` in CI,
 * `stack.sh` locally). Read-only.
 *
 * Each seeded item is compared with its file in `content/library/demo`, and the database's own
 * readiness rules (`app.library_assert_ready`) must accept every reviewed and approved item, so
 * the seed can never show a state the workflow functions could not have produced.
 */
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { LIBRARY_BUCKETS, LIBRARY_ITEM_TYPES, TYPE_INFO } from './catalog';
import { parseCurriculumFile, type CurriculumFile } from './curriculum-import';
import { curriculumExpectationId, curriculumStrandId } from './curriculum-sql';
import {
  SEED_ITEMS_DIR,
  seedItemRequiresFaithReview,
  seedItemSchema,
  seedPackSchema,
  type SeedItem,
} from './seed-pack';
import { seedItemId, seedPackId } from './seed-sql';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

const pool = new pg.Pool({ connectionString, max: 1 });
afterAll(() => pool.end());

// From supabase/seed.sql: the demo board, Nathalie Roy (board admin and reviewer), the 3e MAT
// unit, and the attentes the seed links.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const NATHALIE = 'd0000000-0000-4000-8000-000000000006';
const UNIT_3E_MAT = '30000000-0000-4000-8000-000000000302';
const FRA_3_C1_2 = '20000000-0000-4000-8000-000000030c12';
const FRA_5 = {
  C1: '20000000-0000-4000-8000-000000051c01',
  'C1.2': '20000000-0000-4000-8000-000000051c12',
  D1: '20000000-0000-4000-8000-000000051d01',
  'D1.1': '20000000-0000-4000-8000-000000051d11',
};

const packDir = new URL('../../../content/library/demo/', import.meta.url);
const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const pack = seedPackSchema.parse(readJson(new URL('pack.json', packDir)));
const items: SeedItem[] = readdirSync(new URL(`${SEED_ITEMS_DIR}/`, packDir))
  .filter((file) => file.endsWith('.json'))
  .map((file) => seedItemSchema.parse(readJson(new URL(`${SEED_ITEMS_DIR}/${file}`, packDir))))
  .sort((a, b) => pack.items.indexOf(a.slug) - pack.items.indexOf(b.slug));
const PACK_ID = seedPackId(pack.slug, pack.version);

const curriculumDir = new URL('../../../content/curriculum/', import.meta.url);
const curricula: { name: string; file: CurriculumFile }[] = readdirSync(curriculumDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    name,
    file: parseCurriculumFile(readFileSync(new URL(name, curriculumDir), 'utf8')).data!,
  }));
const idOf = (slug: string) => seedItemId(pack.slug, slug);

/** One seeded item as the database has it, with its references back as codes. */
interface SeededItem {
  id: string;
  type: string;
  bucket: string;
  title: string;
  status: string;
  share_scope: string;
  source: string;
  board_owned: boolean;
  author: string | null;
  school: string | null;
  subject: string | null;
  duration_minutes: number | null;
  sub_friendly: boolean;
  faith_content: boolean;
  requires_faith_review: boolean;
  catholic_reference: string | null;
  review_requested_by: string | null;
  approved_by: string | null;
  faith_reviewed_by: string | null;
  prompt_version: string | null;
  model: string | null;
  usage_count: number;
  indexed: boolean;
  grades: string[];
  attentes: string[];
  tags: string[];
  levels: string[];
  keys: number;
}

async function seededItems(): Promise<Map<string, SeededItem>> {
  const { rows } = await pool.query<SeededItem>(
    `select i.id, i.type::text, i.bucket::text, i.title, i.status::text, i.share_scope::text,
       i.source::text, i.board_owned, au.email as author, sc.slug as school, su.code as subject,
       i.duration_minutes, i.sub_friendly, i.faith_content, i.requires_faith_review,
       cr.title as catholic_reference, rq.email as review_requested_by,
       ap.email as approved_by, fr.email as faith_reviewed_by, i.prompt_version, i.model,
       i.usage_count, i.search_document <> ''::tsvector as indexed,
       array(select g.grade_code from public.library_item_grades g
             where g.item_id = i.id order by g.grade_code) as grades,
       array(select ce.grade_code || ' ' || ce.code from public.library_item_expectations le
             join public.curriculum_expectations ce on ce.id = le.expectation_id
             where le.item_id = i.id order by 1) as attentes,
       array(select t.slug from public.library_item_tags it join public.tags t on t.id = it.tag_id
             where it.item_id = i.id order by 1) as tags,
       array(select coalesce(ll.code, 'base') from public.library_item_versions v
             left join public.language_levels ll on ll.id = v.language_level_id
             where v.item_id = i.id order by 1) as levels,
       (select count(*)::int from public.library_item_versions v
        join public.library_item_answer_keys k on k.version_id = v.id
        where v.item_id = i.id) as keys
     from public.library_items i
     left join public.users au on au.id = i.author_id
     left join public.schools sc on sc.id = i.school_id
     left join public.subjects su on su.id = i.subject_id
     left join public.catholic_references cr on cr.id = i.catholic_reference_id
     left join public.users rq on rq.id = i.review_requested_by
     left join public.users ap on ap.id = i.approved_by
     left join public.users fr on fr.id = i.faith_reviewed_by
     where i.content_pack_id = $1`,
    [PACK_ID],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

describe('library catalogue and database (H3 1)', () => {
  it('the TypeScript catalogue equals the library_item_type enum', async () => {
    const { rows } = await pool.query<{ type: string }>(
      'select unnest(enum_range(null::public.library_item_type))::text as type',
    );
    expect(rows.map((r) => r.type)).toEqual([...LIBRARY_ITEM_TYPES]);
    const buckets = await pool.query<{ bucket: string }>(
      'select unnest(enum_range(null::public.library_bucket))::text as bucket',
    );
    expect(buckets.rows.map((r) => r.bucket)).toEqual([...LIBRARY_BUCKETS]);
  });

  it('app.library_bucket_for gives every type the bucket TYPE_INFO gives it', async () => {
    const { rows } = await pool.query<{ type: string; bucket: string }>(
      `select t::text as type, app.library_bucket_for(t)::text as bucket
       from unnest(enum_range(null::public.library_item_type)) t`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.type, r.bucket]))).toEqual(
      Object.fromEntries(LIBRARY_ITEM_TYPES.map((type) => [type, TYPE_INFO[type].bucket])),
    );
  });
});

describe('the demo library seed (H3 2)', () => {
  it('loads the pack: 78 items in the 6 buckets, with the ids of their slugs', async () => {
    const { rows } = await pool.query<{ slug: string; version: string; board_id: string }>(
      'select slug, version, board_id from public.content_packs where id = $1',
      [PACK_ID],
    );
    expect(rows).toEqual([{ slug: 'demo', version: '2026.1', board_id: BOARD }]);

    const seeded = await seededItems();
    expect(seeded.size).toBe(78);
    expect([...seeded.keys()].sort()).toEqual(pack.items.map(idOf).sort());
    expect(new Set([...seeded.values()].map((i) => i.bucket))).toEqual(new Set(LIBRARY_BUCKETS));
    // The pack's global tags, once each.
    const tags = await pool.query<{ slug: string }>(
      'select slug from public.tags where board_id is null and slug = any($1) order by slug',
      [pack.tags.map((t) => t.slug)],
    );
    expect(tags.rows.map((t) => t.slug)).toEqual(pack.tags.map((t) => t.slug).sort());
  });

  it('stores every item as its file describes it', async () => {
    const seeded = await seededItems();
    for (const item of items) {
      const row = seeded.get(idOf(item.slug));
      expect(row, item.slug).toBeDefined();
      expect(
        {
          type: row!.type,
          title: row!.title,
          status: row!.status,
          scope: row!.share_scope,
          source: row!.source,
          boardOwned: row!.board_owned,
          author: row!.author,
          school: row!.school,
          subject: row!.subject,
          duration: row!.duration_minutes,
          subFriendly: row!.sub_friendly,
          faithContent: row!.faith_content,
          requiresFaithReview: row!.requires_faith_review,
          reference: row!.catholic_reference,
          requestedBy: row!.review_requested_by,
          approvedBy: row!.approved_by,
          faithReviewedBy: row!.faith_reviewed_by,
          provenance: [row!.prompt_version, row!.model],
          grades: row!.grades,
          attentes: row!.attentes,
          tags: row!.tags,
          levels: row!.levels,
          keys: row!.keys,
          indexed: row!.indexed,
        },
        item.slug,
      ).toEqual({
        type: item.type,
        title: item.title,
        status: item.status,
        scope: item.shareScope,
        source: item.source,
        // The board's own items (D-091): no author, kept by its content reviewers.
        boardOwned: item.source === 'board_created',
        author: item.author,
        school: item.school,
        subject: item.subjectCode,
        duration: item.durationMinutes,
        subFriendly: item.subFriendly,
        faithContent: item.faithContent,
        // Computed by the items trigger, like the pack's own rule.
        requiresFaithReview: seedItemRequiresFaithReview(item),
        reference: item.catholicReference,
        requestedBy: item.reviewRequested ? item.author : null,
        approvedBy: item.approvedBy,
        faithReviewedBy: item.faithReviewed ? item.approvedBy : null,
        provenance: [item.promptVersion, item.model],
        grades: [...item.gradeCodes].sort(),
        attentes: item.expectations.map((e) => `${e.grade} ${e.code}`).sort(),
        tags: [...item.tags].sort(),
        levels: item.versions.map((v) => v.level ?? 'base').sort(),
        keys: item.versions.filter((v) => v.answerKey).length,
        indexed: true,
      });
    }
  });

  it('passes the database’s own readiness rules, for approval when approved or requested', async () => {
    const reviewed = items.filter((i) => i.status !== 'draft');
    expect(reviewed.length).toBe(71);
    for (const item of reviewed) {
      // Raises LXL01 (with what is missing) or LXL02, as the workflow functions would.
      await expect(
        pool.query('select app.library_assert_ready($1, $2)', [
          idOf(item.slug),
          item.status === 'board_approved' || item.reviewRequested,
        ]),
        item.slug,
      ).resolves.toBeDefined();
    }
  });

  it('has 19 items with a version for each of the four board levels, 18 of them approved', async () => {
    const { rows } = await pool.query<{ id: string; status: string }>(
      `select i.id, i.status::text from public.library_items i
       where i.content_pack_id = $1
         and (select count(*) from public.library_item_versions v
              join public.language_levels ll on ll.id = v.language_level_id
              where v.item_id = i.id and ll.board_id = $2 and ll.owner_user_id is null) = 4`,
      [PACK_ID, BOARD],
    );
    expect(rows).toHaveLength(19);
    expect(rows.filter((r) => r.status === 'board_approved')).toHaveLength(18);
    // The other one is Marc's exit ticket, waiting in the reviewer's queue.
    const waiting = rows.find((r) => r.status !== 'board_approved');
    expect(waiting?.id).toBe(idOf('billet-fractions-equivalentes'));
  });

  it('approves « Le huard, oiseau des lacs » for substitutes, linked to 3e C1.2', async () => {
    const { rows } = await pool.query<{
      title: string;
      status: string;
      sub_friendly: boolean;
      linked: boolean;
      found: boolean;
    }>(
      `select i.title, i.status::text, i.sub_friendly,
         exists (select 1 from public.library_item_expectations le
                 where le.item_id = i.id and le.expectation_id = $2) as linked,
         i.search_document @@ to_tsquery('app.french_unaccent', 'huard') as found
       from public.library_items i where i.id = $1`,
      [idOf('huard-oiseau-des-lacs'), FRA_3_C1_2],
    );
    expect(rows).toEqual([
      {
        title: 'Le huard, oiseau des lacs',
        status: 'board_approved',
        sub_friendly: true,
        linked: true,
        found: true,
      },
    ]);
  });

  it('links 3e MAT lesson 5 to « Ordonner des nombres jusqu’à 1 000 », counted once', async () => {
    const item = idOf('ordonner-nombres-1000');
    expect(item).toBe('191569be-69c6-5fc4-beeb-b9fd92bb45c8');
    const { rows } = await pool.query<{ title: string; library_item_id: string }>(
      `select title, library_item_id from public.unit_lessons
       where unit_id = $1 and sequence_number = 5`,
      [UNIT_3E_MAT],
    );
    expect(rows).toEqual([{ title: 'Ordonner des nombres', library_item_id: item }]);
    const usage = await pool.query<{ usage_count: number; units: number }>(
      `select i.usage_count,
         (select count(distinct l.unit_id)::int from public.unit_lessons l
          where l.library_item_id = i.id) as units
       from public.library_items i where i.id = $1`,
      [item],
    );
    // The usage trigger counted the seed's link: one unit.
    expect(usage.rows[0]).toEqual({ usage_count: 1, units: 1 });
  });

  it('designates Nathalie Roy as the board’s reviewer for content and faith', async () => {
    const { rows } = await pool.query(
      `select approves_content, reviews_faith from public.library_reviewers
       where board_id = $1 and user_id = $2`,
      [BOARD, NATHALIE],
    );
    expect(rows).toEqual([{ approves_content: true, reviews_faith: true }]);
  });

  it('adds the four 5e Français attentes, unverified, under their overall attentes', async () => {
    const { rows } = await pool.query<{
      id: string;
      code: string;
      kind: string;
      parent_code: string | null;
      strand: string;
      is_verified: boolean;
    }>(
      `select ce.id, ce.code, ce.kind::text, p.code as parent_code, st.code as strand,
         ce.is_verified
       from public.curriculum_expectations ce
       join public.subjects su on su.id = ce.subject_id and su.code = 'fra' and su.board_id is null
       join public.strands st on st.id = ce.strand_id
       left join public.curriculum_expectations p on p.id = ce.parent_id
       where ce.grade_code = '5' and ce.id = any($1)
       order by ce.sort_order`,
      [Object.values(FRA_5)],
    );
    expect(rows).toEqual([
      {
        id: FRA_5.C1,
        code: 'C1',
        kind: 'overall',
        parent_code: null,
        strand: 'C',
        is_verified: false,
      },
      {
        id: FRA_5['C1.2'],
        code: 'C1.2',
        kind: 'specific',
        parent_code: 'C1',
        strand: 'C',
        is_verified: false,
      },
      {
        id: FRA_5.D1,
        code: 'D1',
        kind: 'overall',
        parent_code: null,
        strand: 'D',
        is_verified: false,
      },
      {
        id: FRA_5['D1.1'],
        code: 'D1.1',
        kind: 'specific',
        parent_code: 'D1',
        strand: 'D',
        is_verified: false,
      },
    ]);
  });
});

describe('the library growth demo (40_library_growth_demo.sql)', () => {
  const MARC = 'd0000000-0000-4000-8000-000000000002';
  const PAUL = 'd0000000-0000-4000-8000-000000000003';
  const ADAPTATION = '40000000-0000-4000-8000-000000000001';

  it('gives « Le huard, oiseau des lacs » two opinions, too few for an average', async () => {
    const { rows } = await pool.query<{ rater_id: string; rating: number }>(
      `select rater_id, rating from public.library_item_ratings where item_id = $1 order by rating desc`,
      [idOf('huard-oiseau-des-lacs')],
    );
    expect(rows).toEqual([
      { rater_id: MARC, rating: 5 },
      { rater_id: PAUL, rating: 4 },
    ]);
  });

  it('holds Marc’s private adaptation of a board resource, credited to its original', async () => {
    const original = idOf('moyenne-mediane-mode');
    const { rows } = await pool.query(
      `select i.status::text, i.share_scope::text, i.source::text, i.author_id, i.board_owned,
         i.parent_item_id, i.parent_title, i.share_cap::text, i.sub_friendly,
         (select count(*)::int from public.library_item_versions v where v.item_id = i.id) as versions,
         (select count(*)::int from public.library_item_versions v where v.item_id = $2) as original_versions,
         exists (select 1 from public.audit_log a where a.action = 'library_item.remixed'
                 and a.entity_id = i.id and a.actor_user_id = $3) as audited
       from public.library_items i where i.id = $1`,
      [ADAPTATION, original, MARC],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      status: 'draft',
      share_scope: 'private',
      source: 'teacher_created',
      author_id: MARC,
      board_owned: false,
      parent_item_id: original,
      parent_title: 'La moyenne, la médiane et le mode',
      share_cap: null,
      sub_friendly: false,
      audited: true,
    });
    expect(row.versions).toBe(row.original_versions);
  });
});

describe('the curriculum sample seed (10_curriculum_demo.sql)', () => {
  interface Row {
    id: string;
    subject: string;
    version: string;
    grade: string;
    code: string;
    kind: string;
    strand: string | null;
    parent: string | null;
    text_fr: string;
    is_verified: boolean;
    sort_order: number;
  }

  async function rows(): Promise<Map<string, Row>> {
    const { rows } = await pool.query<Row>(
      `select ce.id, su.code as subject, ce.curriculum_version as version,
         ce.grade_code as grade, ce.code, ce.kind::text, st.code as strand, p.code as parent,
         ce.text_fr, ce.is_verified, ce.sort_order
       from public.curriculum_expectations ce
       join public.subjects su on su.id = ce.subject_id and su.board_id is null
       left join public.strands st on st.id = ce.strand_id
       left join public.curriculum_expectations p on p.id = ce.parent_id
       where (su.code, ce.curriculum_version) in (select * from unnest($1::text[], $2::text[]))`,
      [curricula.map((c) => c.file.subjectCode), curricula.map((c) => c.file.curriculumVersion)],
    );
    return new Map(rows.map((r) => [`${r.subject} ${r.version} ${r.grade} ${r.code}`, r]));
  }

  it('holds every attente of content/curriculum, unverified, in its strand and under its parent', async () => {
    expect(curricula.length).toBeGreaterThanOrEqual(6);
    const seeded = await rows();
    const expected = curricula.flatMap(({ file }) => file.expectations.map((e) => ({ file, e })));
    expect(seeded.size).toBe(expected.length);
    const positions = new Map<string, number>();
    for (const { file, e } of expected) {
      const key = `${file.subjectCode} ${file.curriculumVersion} ${e.grade} ${e.code}`;
      const grade = `${file.subjectCode} ${e.grade}`;
      const position = (positions.get(grade) ?? 0) + 1;
      positions.set(grade, position);
      const row = seeded.get(key);
      expect(row, key).toBeDefined();
      expect(
        {
          kind: row!.kind,
          strand: row!.strand,
          parent: row!.parent,
          verified: row!.is_verified,
          sortOrder: row!.sort_order,
        },
        key,
      ).toEqual({
        kind: e.kind,
        strand: e.strandCode,
        parent: e.parentCode,
        verified: false,
        sortOrder: position,
      });
      // New rows have their UUIDv5 id and the file's text; rows of seed.sql keep theirs.
      if (row!.id.startsWith('20000000-')) continue;
      expect(row!.id, key).toBe(
        curriculumExpectationId(file.subjectCode, file.curriculumVersion, e.grade, e.code),
      );
      expect(row!.text_fr, key).toBe(e.textFr);
    }
  });

  it('keeps the attentes of seed.sql: their ids, wording and source note', async () => {
    const { rows } = await pool.query<{ id: string; code: string; text_fr: string; note: string }>(
      `select ce.id, ce.code, ce.text_fr, ce.source_note as note
       from public.curriculum_expectations ce where ce.id::text like '20000000-%' order by ce.id`,
    );
    expect(rows).toHaveLength(22);
    expect(new Set(rows.map((r) => r.note))).toEqual(
      new Set(['Résumé à vérifier contre le document officiel.']),
    );
    expect(rows.find((r) => r.id === FRA_3_C1_2)).toMatchObject({
      code: 'C1.2',
      text_fr: "Repérer l'idée principale et quelques détails importants d'un texte informatif.",
    });
  });

  it('adds the missing strands with their ids, in the files’ order', async () => {
    const { rows } = await pool.query<{ id: string; subject: string; code: string; sort: number }>(
      `select st.id, su.code as subject, st.code, st.sort_order as sort
       from public.strands st join public.subjects su on su.id = st.subject_id
       where su.board_id is null and st.curriculum_version in ('fra-2023', 'mat-2020', 'sci-2022')
       order by su.code, st.sort_order`,
    );
    const versions = new Map(curricula.map(({ file }) => [file.subjectCode, file]));
    expect(rows.map((r) => `${r.subject} ${r.code} ${r.sort}`)).toEqual(
      [...versions.values()]
        .sort((a, b) => a.subjectCode.localeCompare(b.subjectCode))
        .flatMap((f) => f.strands.map((s, i) => `${f.subjectCode} ${s.code} ${i + 1}`)),
    );
    // seed.sql's strands keep their ids (lessons and tests point at them).
    const mat = rows.find((r) => r.subject === 'mat' && r.code === 'B');
    expect(mat?.id).toBe('10000000-0000-4000-8000-00000000aa02');
    const matA = rows.find((r) => r.subject === 'mat' && r.code === 'A');
    expect(matA?.id).toBe(curriculumStrandId('mat', 'mat-2020', 'A'));
  });
});
