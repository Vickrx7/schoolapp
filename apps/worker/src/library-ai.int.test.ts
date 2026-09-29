/**
 * Integration test for the library's AI (DECISIONS D-072, D-073), end to end with the fake
 * provider: the teacher's request built by the database from ids, the worker's run with the
 * whole roster, and the database turning the answer into her private draft (or new versions of
 * her resource). Needs a migrated and seeded database (DATABASE_URL). Everything runs in
 * transactions that are rolled back, so the demo data is untouched. Run with `pnpm test:int`,
 * with the worker stopped.
 */
import { randomUUID } from 'node:crypto';
import { createFakeProvider, priceFor } from '@lynx/ai';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runAiJob, type AiRuntime } from './ai';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo board and school, Isabelle Tremblay (3e année), the 3e année
// Mathématiques attente B1.2. Samuel is one of her students.
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const B1_2 = '20000000-0000-4000-8000-000000030b12';

const pool = new pg.Pool({ connectionString });
const ai: AiRuntime = { provider: createFakeProvider(), price: priceFor('fake') };
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

afterAll(async () => {
  await pool.end();
});

/** Runs `fn` in a transaction that is always rolled back, with the school's AI on. */
async function inRollback(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('update public.schools set ai_enabled = true where id = $1', [SCHOOL]);
    await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Runs `sql` as Isabelle (the API role and her claims), then goes back to the worker's role. */
async function asTeacher<T extends pg.QueryResultRow>(
  db: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  await db.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true),
            set_config('role', 'authenticated', true)`,
    [JSON.stringify({ sub: TEACHER, role: 'authenticated' }), TEACHER],
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.query('reset role');
  }
}

async function boardLevels(db: pg.PoolClient): Promise<Record<string, string>> {
  const { rows } = await db.query<{ code: string; id: string }>(
    `select code, id from public.language_levels
      where board_id = $1 and owner_user_id is null and active`,
    [BOARD],
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

describe('« Créer avec l’IA » (library_item)', () => {
  it('turns the teacher’s request into her private draft with four levels and a faith link', async () => {
    await inRollback(async (db) => {
      const levels = await boardLevels(db);
      const { rows: refs } = await db.query<{ id: string }>(
        `select id from public.catholic_references where board_id = $1 and title = 'Le respect'`,
        [BOARD],
      );
      const { rows: subjects } = await db.query<{ id: string }>(
        `select id from public.subjects where code = 'mat' and board_id is null`,
      );
      const request = {
        itemType: 'worksheet',
        gradeCodes: ['3'],
        subjectId: subjects[0]!.id,
        expectationIds: [B1_2],
        levelIds: [levels.enrichi, levels.debutant, levels.avance, levels.intermediaire],
        catholicReferenceId: refs[0]!.id,
        durationMinutes: 30,
        subFriendly: true,
        teacherNote: 'Pour Samuel, des nombres simples.',
      };
      const [preview] = await asTeacher<{ input: Record<string, unknown> }>(
        db,
        'select public.library_item_ai_preview($1, $2::jsonb) as input',
        [SCHOOL, JSON.stringify(request)],
      );
      const [job] = await asTeacher<{ id: string }>(
        db,
        'select public.request_library_item($1, $2::jsonb) as id',
        [SCHOOL, JSON.stringify(request)],
      );
      const { rows: stored } = await db.query('select input from public.ai_jobs where id = $1', [
        job!.id,
      ]);
      expect(stored[0].input).toEqual(preview!.input);

      await runAiJob(job!.id, { pool: db, ai, logger: silent });

      const { rows } = await db.query(
        `select j.status, j.sent_text, j.result ->> 'itemId' as item_id, g.prompt_version, g.model
           from public.ai_jobs j join public.ai_generations g on g.id = j.ai_generation_id
          where j.id = $1`,
        [job!.id],
      );
      expect(rows[0]).toMatchObject({ status: 'succeeded', prompt_version: 'v1', model: 'fake' });
      // Sent: a marker for the student, no ids.
      const sent: string = rows[0].sent_text;
      expect(sent).toContain('Pour Élève A, des nombres simples.');
      expect(sent).not.toMatch(/Samuel|Tremblay|Saint-Exemple/);
      expect(sent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);

      const itemId: string = rows[0].item_id;
      const { rows: items } = await db.query(
        `select author_id, status, share_scope, source, prompt_version, model, sub_friendly,
                requires_faith_review, catholic_reference_id, catholic_connection, type,
                (select count(*)::int from public.library_item_versions v where v.item_id = i.id) as versions,
                (select count(*)::int from public.library_item_answer_keys k
                   join public.library_item_versions v on v.id = k.version_id
                  where v.item_id = i.id) as keys,
                (select array_agg(e.expectation_id) from public.library_item_expectations e
                  where e.item_id = i.id) as expectations
           from public.library_items i where i.id = $1`,
        [itemId],
      );
      expect(items[0]).toMatchObject({
        author_id: TEACHER,
        status: 'draft',
        share_scope: 'private',
        source: 'ai_generated',
        prompt_version: 'v1',
        model: 'fake',
        sub_friendly: true,
        requires_faith_review: true,
        catholic_reference_id: refs[0]!.id,
        type: 'worksheet',
        versions: 5,
        keys: 5,
        expectations: [B1_2],
      });
      expect(items[0].catholic_connection).toContain('Le respect');

      // The draft is hers: she sees it, a colleague does not.
      const mine = await asTeacher(db, 'select id from public.library_items where id = $1', [
        itemId,
      ]);
      expect(mine).toHaveLength(1);
    });
  });
});

describe('« Créer les versions manquantes avec l’IA » (library_levels)', () => {
  it('adds the missing levels to the teacher’s resource', async () => {
    await inRollback(async (db) => {
      const levels = await boardLevels(db);
      const itemId = randomUUID();
      // A game with one true-or-false question, as the editor saves it (canonical content).
      const content = {
        title: '',
        objective: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        teacherNote: '',
        grouping: 'En équipes de deux',
        setup: 'Un paquet de cartes-nombres par équipe.',
        rules: ['Chaque personne retourne une carte.', 'Le plus grand nombre gagne les cartes.'],
        howToWin: 'Avoir le plus de cartes à la fin.',
        variations: [],
        questions: [
          {
            id: 'tf1',
            kind: 'true_false',
            prompt: '450 est plus petit que 540.',
            hint: '',
            points: null,
            category: null,
          },
        ],
      };
      const answerKey = {
        answers: [{ questionId: 'tf1', kind: 'true_false', correct: true, explanation: '' }],
        solution: '',
      };
      await asTeacher(db, 'select * from public.save_library_item($1, null, $2::jsonb)', [
        itemId,
        JSON.stringify({
          boardId: BOARD,
          schoolId: SCHOOL,
          type: 'game',
          title: 'La bataille des nombres (essai)',
          summary: '',
          licence: '',
          subjectId: null,
          durationMinutes: 20,
          materials: 'Cartes',
          keywords: 'nombres',
          isPrintable: true,
          isProjectable: false,
          isInteractive: false,
          subFriendly: false,
          safetyNotes: null,
          faithContent: false,
          faithOnStudentSheet: false,
          catholicConnection: '',
          catholicReferenceId: null,
          gradeCodes: ['3'],
          expectationIds: [],
          tagIds: [],
          versions: [{ languageLevelId: null, content, answerKey }],
        }),
      ]);
      const [job] = await asTeacher<{ id: string }>(
        db,
        'select public.request_library_levels($1, $2, $3::uuid[]) as id',
        [itemId, SCHOOL, [levels.debutant, levels.enrichi]],
      );

      await runAiJob(job!.id, { pool: db, ai, logger: silent });

      const { rows } = await db.query(
        `select status, result ->> 'itemId' as item_id, result ->> 'levelsAdded' as added
           from public.ai_jobs where id = $1`,
        [job!.id],
      );
      expect(rows[0]).toMatchObject({ status: 'succeeded', item_id: itemId, added: '2' });
      const { rows: versions } = await db.query<{ level: string | null; objective: string }>(
        `select ll.code as level, v.content ->> 'objective' as objective
           from public.library_item_versions v
           left join public.language_levels ll on ll.id = v.language_level_id
          where v.item_id = $1 order by ll.sort_order nulls first`,
        [itemId],
      );
      expect(versions.map((v) => v.level)).toEqual([null, 'debutant', 'enrichi']);
      expect(new Set(versions.map((v) => v.objective)).size).toBe(1);
      const { rows: item } = await db.query(
        'select content_revision from public.library_items where id = $1',
        [itemId],
      );
      expect(item[0].content_revision).toBe(2);
    });
  });
});
