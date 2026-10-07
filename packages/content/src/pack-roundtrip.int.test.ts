/**
 * Content packs from one board to another (Phase 5 plan H3 test 4; DECISIONS D-099, D-100). The
 * demo board's approved resources are exported through the database, built into a v1 pack with
 * `pack-format.ts` (as the admin CLI does) and validated; then the pack is staged, previewed and
 * applied into a board created in the test's transaction, and every version and answer key
 * arrives deep-equal. Applying the same version again is refused (LXP01), and version 2026.2
 * with one changed requested item, one changed approved item and one locally edited item gives
 * the expected outcomes.
 *
 * Needs a migrated and seeded database (DATABASE_URL). Everything runs in one transaction, rolled
 * back at the end; the pack functions run as the operator's role (service_role).
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assemblePack,
  contentPackItemSchema,
  itemHash,
  packChecksum,
  packExportPageSchema,
  packItemFromExport,
  packItemSuggestsFaith,
  packTagsFromExport,
  validatePack,
  type ContentPack,
  type ContentPackItem,
  type PackExportRow,
  type PackLevel,
} from './pack-format';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

const pool = new pg.Pool({ connectionString, max: 1 });
let db: pg.PoolClient;

/** The demo board (supabase/seed.sql). */
const DEMO_BOARD = 'b0000000-0000-4000-8000-000000000001';
const SLUG = 'aller-retour';

beforeAll(async () => {
  db = await pool.connect();
  await db.query('begin');
});

afterAll(async () => {
  await db.query('rollback');
  db.release();
  await pool.end();
});

/** A statement as the operator (service role), then back to the test's own role. */
async function asOperator<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  await db.query('set local role service_role');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.query('reset role');
  }
}

/**
 * The SQLSTATE a statement fails with as the operator, or null. Its changes, and the role, are
 * rolled back to a savepoint.
 */
async function errorCode(sql: string, params: unknown[] = []): Promise<string | null> {
  await db.query('savepoint attempt');
  try {
    await db.query('set local role service_role');
    await db.query(sql, params);
    await db.query('release savepoint attempt');
    await db.query('reset role');
    return null;
  } catch (err) {
    await db.query('rollback to savepoint attempt');
    await db.query('reset role');
    return (err as { code?: string }).code ?? 'unknown';
  }
}

/** Stages a pack for a board as the CLI does, and returns the import's id. */
async function stage(boardId: string, pack: ContentPack): Promise<string> {
  const { items, ...header } = pack;
  const text = JSON.stringify(pack);
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const staged = await asOperator<{ id: string }>(
    'select public.content_pack_stage($1, $2::jsonb, $3) as id',
    [boardId, JSON.stringify(header), sha],
  );
  const importId = staged.rows[0]!.id;
  const faithKeys = items.filter(packItemSuggestsFaith).map((item) => item.key);
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    await asOperator('select public.content_pack_stage_items($1, $2::jsonb, $3)', [
      importId,
      JSON.stringify(chunk),
      faithKeys.filter((key) => chunk.some((item) => item.key === key)),
    ]);
  }
  return importId;
}

interface ReportItem {
  key: string;
  outcome: string;
  queued: boolean;
  approved: boolean;
  warnings: string[];
}
interface Report {
  counts: Record<string, number>;
  items: ReportItem[];
  notInPack: string[];
}

async function run(fn: 'preview' | 'apply', importId: string): Promise<Report> {
  const { rows } = await asOperator<{ report: Report }>(
    `select public.content_pack_${fn}($1, '{}'::jsonb) as report`,
    [importId],
  );
  return rows[0]!.report;
}

/** An imported item's versions: level code (or « base ») → content and answer key. */
async function versionsOf(boardId: string, key: string) {
  const { rows } = await db.query<{
    level: string;
    content: Record<string, unknown>;
    answer_key: Record<string, unknown> | null;
  }>(
    `select coalesce(ll.code, 'base') as level, v.content, k.answer_key
     from public.library_items i
     join public.library_item_versions v on v.item_id = i.id
     left join public.language_levels ll on ll.id = v.language_level_id
     left join public.library_item_answer_keys k on k.version_id = v.id
     where i.board_id = $1 and i.pack_slug = $2 and i.pack_item_key = $3`,
    [boardId, SLUG, key],
  );
  return Object.fromEntries(rows.map((r) => [r.level, { content: r.content, key: r.answer_key }]));
}

let pack: ContentPack;
let boardId: string;
let firstApply: Report;

describe('a content pack from the demo board to a new board (H3 4)', () => {
  it('exports the demo board’s approved resources into a valid v1 pack', async () => {
    const rows: PackExportRow[] = [];
    let levels: PackLevel[] = [];
    let after: string | null = null;
    do {
      const { rows: page } = await asOperator<{ page: unknown }>(
        'select public.content_pack_export_items($1, $2::jsonb, $3, 20) as page',
        [
          DEMO_BOARD,
          JSON.stringify({
            slug: SLUG,
            publisher: 'IP Lynx',
            includeTeacherItems: true,
            includePackItems: true,
          }),
          after,
        ],
      );
      const parsed = packExportPageSchema.parse(page[0]!.page);
      rows.push(...parsed.items);
      if (parsed.levels) levels = parsed.levels;
      after = parsed.next;
    } while (after);

    const approved = await db.query<{ n: number }>(
      `select count(*)::int as n from public.library_items
       where board_id = $1 and status = 'board_approved'`,
      [DEMO_BOARD],
    );
    expect(rows).toHaveLength(approved.rows[0]!.n);
    expect(rows.length).toBeGreaterThan(40);

    const items: ContentPackItem[] = rows.map((row) => packItemFromExport(row));
    for (const item of items) {
      expect(contentPackItemSchema.safeParse(item).error?.issues ?? [], item.key).toEqual([]);
    }
    pack = assemblePack({
      header: {
        slug: SLUG,
        version: '2026.1',
        title: 'Aller-retour',
        publisher: 'IP Lynx',
        licence: 'Test',
        noDerivatives: false,
        createdAt: '2026-11-01T12:00:00.000Z',
        contentSchemaVersion: 1,
      },
      levels,
      tags: packTagsFromExport(rows),
      items,
    });
    expect(validatePack(JSON.parse(JSON.stringify(pack))).errors).toEqual([]);
    // No person, school or id of the exporting board travels.
    const text = JSON.stringify(pack);
    expect(text).not.toMatch(/@demo\.lynx\.test|"(author|school|approvedBy|status)"/);
    expect(text).not.toContain(DEMO_BOARD);
  });

  it('previews without writing, then applies every item into a new board', async () => {
    const board = await db.query<{ id: string }>(
      `insert into public.boards (name, slug) values ('Conseil aller-retour', $1) returning id`,
      [`aller-retour-${Date.now().toString(36)}`],
    );
    boardId = board.rows[0]!.id;
    await db.query('select public.provision_board_defaults($1)', [boardId]);

    const importId = await stage(boardId, pack);
    const count = async () =>
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from public.library_items where board_id = $1',
          [boardId],
        )
      ).rows[0]!.n;
    const preview = await run('preview', importId);
    expect(await count()).toBe(0);
    expect(preview.counts.created).toBe(pack.items.length);

    firstApply = await run('apply', importId);
    expect(firstApply.counts).toMatchObject({
      created: pack.items.length,
      updated: 0,
      unchanged: 0,
      skippedUnresolved: 0,
    });
    expect(firstApply.items.map((i) => [i.key, i.outcome, i.queued])).toEqual(
      preview.items.map((i) => [i.key, i.outcome, i.queued]),
    );
    expect(await count()).toBe(pack.items.length);
  });

  it('brings every version and answer key over unchanged', async () => {
    for (const item of pack.items) {
      const versions = await versionsOf(boardId, item.key);
      expect(Object.keys(versions).sort(), item.key).toEqual(
        item.versions.map((v) => v.level ?? 'base').sort(),
      );
      for (const version of item.versions) {
        expect(versions[version.level ?? 'base'], `${item.key} ${version.level ?? 'base'}`).toEqual(
          { content: version.content, key: version.answerKey },
        );
      }
    }
    // The items keep their grades, attentes and tags, by code.
    const { rows } = await db.query<{ key: string; grades: string[]; attentes: string[] }>(
      `select i.pack_item_key as key,
         array(select g.grade_code from public.library_item_grades g where g.item_id = i.id
               order by g.grade_code) as grades,
         array(select ce.curriculum_version || ' ' || ce.grade_code || ' ' || ce.code
               from public.library_item_expectations le
               join public.curriculum_expectations ce on ce.id = le.expectation_id
               where le.item_id = i.id order by 1) as attentes
       from public.library_items i where i.board_id = $1`,
      [boardId],
    );
    for (const row of rows) {
      const item = pack.items.find((i) => i.key === row.key)!;
      expect(row.grades, row.key).toEqual([...item.gradeCodes].sort());
      expect(row.attentes, row.key).toEqual(
        item.expectations.map((e) => `${e.curriculumVersion} ${e.gradeCode} ${e.code}`).sort(),
      );
    }
  });

  it('refuses the same version again (LXP01)', async () => {
    const { items, ...header } = pack;
    expect(
      await errorCode('select public.content_pack_stage($1, $2::jsonb, $3)', [
        boardId,
        JSON.stringify(header),
        'f'.repeat(64),
      ]),
    ).toBe('LXP01');
    expect(items.length).toBeGreaterThan(0);
  });

  it('2026.2: updates an untouched requested item, keeps an approved one and a locally edited one', async () => {
    const queued = firstApply.items.filter((i) => i.queued).map((i) => i.key);
    expect(queued.length).toBeGreaterThanOrEqual(3);
    const [requestedKey, approvedKey, editedKey] = queued as [string, string, string];
    const idOf = async (key: string) =>
      (
        await db.query<{ id: string }>(
          'select id from public.library_items where board_id = $1 and pack_slug = $2 and pack_item_key = $3',
          [boardId, SLUG, key],
        )
      ).rows[0]!.id;
    // A reviewer approves one (its content does not change); someone edits another.
    await db.query(
      `update public.library_items set status = 'board_approved', share_scope = 'board',
         review_requested_at = null, approved_at = now() where id = $1`,
      [await idOf(approvedKey)],
    );
    await db.query('select app.library_content_changed($1)', [await idOf(editedKey)]);

    const changed = new Set([requestedKey, approvedKey, editedKey]);
    const items = pack.items.map((item) => {
      if (!changed.has(item.key)) return item;
      const { hash: _hash, ...rest } = { ...item, title: `${item.title} (2e version)` };
      return { ...rest, hash: itemHash(rest) } as ContentPackItem;
    });
    const second: ContentPack = {
      ...pack,
      pack: { ...pack.pack, version: '2026.2' },
      items,
      checksum: packChecksum(items),
    };
    expect(validatePack(JSON.parse(JSON.stringify(second))).errors).toEqual([]);

    const report = await run('apply', await stage(boardId, second));
    const outcome = (key: string) => report.items.find((i) => i.key === key)?.outcome;
    expect(outcome(requestedKey)).toBe('update');
    expect(outcome(approvedKey)).toBe('changed_not_applied');
    expect(outcome(editedKey)).toBe('skipped_modified_locally');
    expect(report.counts.unchanged).toBe(pack.items.length - 3);
    expect(report.notInPack).toEqual([]);

    const titles = await db.query<{
      key: string;
      title: string;
      status: string;
      requested: boolean;
    }>(
      `select pack_item_key as key, title, status::text as status,
         review_requested_at is not null as requested
       from public.library_items where board_id = $1 and pack_item_key = any($2)`,
      [boardId, [...changed]],
    );
    const byKey = new Map(titles.rows.map((r) => [r.key, r]));
    const original = (key: string) => pack.items.find((i) => i.key === key)!.title;
    expect(byKey.get(requestedKey)).toEqual({
      key: requestedKey,
      title: `${original(requestedKey)} (2e version)`,
      status: 'teacher_reviewed',
      requested: true,
    });
    expect(byKey.get(approvedKey)?.title).toBe(original(approvedKey));
    expect(byKey.get(editedKey)?.title).toBe(original(editedKey));
  });
});
