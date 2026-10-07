/**
 * Integration test for « Traduire en anglais (IA) » (DECISIONS D-139), end to end with the fake
 * provider: the request built by the database from the stored « Info-parents » message, the
 * worker's run with the whole roster (people the app knows become markers and come back; a
 * paragraph naming « Mme Dupuis », whom the app does not know, is never sent, even when the
 * request asks for it), and the database writing the English back on its paragraphs only while
 * the message is unchanged. Needs a migrated and seeded database (DATABASE_URL). Everything runs
 * in transactions that are rolled back, so the demo data is untouched. Run with `pnpm test:int`,
 * with the worker stopped.
 */
import { createFakeProvider, priceFor } from '@lynx/ai';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runAiJob, type AiRuntime } from './ai';
import type { Logger } from './logger';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');

// From supabase/seed.sql: the demo school, Isabelle Tremblay and her 3e année class, where
// Samuel is a student.
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const TEACHER = 'd0000000-0000-4000-8000-000000000001';
const CLASS_3E = 'e0000000-0000-4000-8000-000000000003';
/** A Monday of the demo school year that the browser tests never use. */
const WEEK = '2027-05-31';

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

const paragraph = (id: string, fr: string) => ({
  id,
  fr,
  en: '',
  enFrom: null,
  enBy: null,
  from: { kind: 'typed' },
});

/** A message of the 3e class with four paragraphs to translate. */
const CONTENT = {
  v: 1,
  signature: 'Mme Tremblay',
  sections: [
    {
      key: 'message',
      off: false,
      items: [
        paragraph('item0001', 'Bravo à Samuel pour son exposé sur les castors !'),
        paragraph('item0002', 'Merci à Mme Dupuis, qui a accompagné la sortie.'),
      ],
    },
    { key: 'thisWeek', off: false, items: [] },
    { key: 'nextWeek', off: false, items: [] },
    {
      key: 'dates',
      off: false,
      items: [paragraph('item0003', 'jeudi 3 juin : départ hâtif à 13 h 35')],
    },
    {
      key: 'reminders',
      off: false,
      items: [paragraph('item0004', 'Mme Tremblay vous remercie de signer l’agenda.')],
    },
    { key: 'atHome', off: false, items: [] },
    { key: 'faith', off: false, items: [] },
    { key: 'closing', off: false, items: [] },
  ],
};

async function newsletter(db: pg.PoolClient): Promise<string> {
  const [row] = await asTeacher<{ id: string }>(
    db,
    `insert into public.class_newsletters (class_id, week_of, content)
     values ($1, $2, $3::jsonb) returning id`,
    [CLASS_3E, WEEK, JSON.stringify(CONTENT)],
  );
  return row!.id;
}

type Item = { id: string; fr: string; en: string; enFrom: string | null; enBy: string | null };

async function stored(db: pg.PoolClient, id: string) {
  const { rows } = await db.query<{
    content: { sections: { items: Item[] }[] };
    revision: number;
    updated_by: string;
  }>('select content, revision, updated_by from public.class_newsletters where id = $1', [id]);
  const row = rows[0]!;
  const items = new Map(row.content.sections.flatMap((s) => s.items).map((i) => [i.id, i]));
  return { items, revision: row.revision, updatedBy: row.updated_by };
}

describe('« Traduire en anglais (IA) » (newsletter_translate)', () => {
  it('writes the English back with the names the app knows, and never sends an unknown name', async () => {
    await inRollback(async (db) => {
      const id = await newsletter(db);
      const [preview] = await asTeacher<{ input: { items: { key: string }[] } }>(
        db,
        `select public.newsletter_ai_preview($1, 'missing') as input`,
        [id],
      );
      expect(preview!.input.items.map((i) => i.key)).toEqual(['P1', 'P2', 'P3', 'P4']);
      // Even a request that asks for the « Mme Dupuis » paragraph (the app's preview leaves it
      // out): the worker leaves it out on its own.
      const [job] = await asTeacher<{ id: string }>(
        db,
        `select public.request_newsletter_translation($1, 'missing', 1, $2) as id`,
        [id, ['P1', 'P2', 'P3', 'P4']],
      );

      await runAiJob(job!.id, { pool: db, ai, logger: silent });

      const { rows } = await db.query(
        `select j.status, j.error_code, j.sent_text, j.result -> 'applied' as applied, g.feature,
                g.prompt_version
           from public.ai_jobs j join public.ai_generations g on g.id = j.ai_generation_id
          where j.id = $1`,
        [job!.id],
      );
      expect(rows[0]).toMatchObject({
        status: 'succeeded',
        error_code: null,
        applied: 3,
        feature: 'newsletter_translate',
        prompt_version: 'v1',
      });
      const sent: string = rows[0].sent_text;
      // Exactly what left: the paragraphs with markers, never the unknown name, the people the
      // app knows, an id, the class or the signature.
      expect(sent).toContain('<P1>\nBravo à Élève A pour son exposé sur les castors !\n</P1>');
      expect(sent).toContain('<P4>\nAdulte A vous remercie de signer l’agenda.\n</P4>');
      expect(sent).not.toContain('<P2>');
      expect(sent).not.toMatch(/Dupuis|Samuel|Tremblay|item000|3e année – |e0000000/);

      const after = await stored(db, id);
      expect(after.items.get('item0001')).toMatchObject({
        en: 'Demo translation: Samuel.',
        enFrom: 'Bravo à Samuel pour son exposé sur les castors !',
        enBy: 'ai',
      });
      expect(after.items.get('item0003')).toMatchObject({
        en: 'Demo translation: Thursday, 3, June, early dismissal, 1:35 p.m.',
        enBy: 'ai',
      });
      expect(after.items.get('item0004')).toMatchObject({
        en: 'Demo translation: Mme Tremblay.',
        enBy: 'ai',
      });
      // The paragraph left out keeps its empty English: the teacher writes it herself.
      expect(after.items.get('item0002')).toMatchObject({ en: '', enBy: null });
      expect(after.revision).toBe(2);
      expect(after.updatedBy).toBe(TEACHER);
    });
  });

  it('writes nothing in a message saved during the translation (newsletterChanged)', async () => {
    await inRollback(async (db) => {
      const id = await newsletter(db);
      const [job] = await asTeacher<{ id: string }>(
        db,
        `select public.request_newsletter_translation($1, 'all', 1, $2) as id`,
        [id, ['P1', 'P3']],
      );
      // A colleague saves while the AI translates.
      await asTeacher(
        db,
        `update public.class_newsletters
            set content = jsonb_set(content, '{signature}', '"M. Gagnon"') where id = $1`,
        [id],
      );

      await runAiJob(job!.id, { pool: db, ai, logger: silent });

      const { rows } = await db.query(
        'select status, error_code, result from public.ai_jobs where id = $1',
        [job!.id],
      );
      expect(rows[0]).toEqual({ status: 'failed', error_code: 'newsletterChanged', result: null });
      const after = await stored(db, id);
      expect([...after.items.values()].map((i) => i.enBy)).toEqual([null, null, null, null]);
      expect(after.revision).toBe(2);
    });
  });
});
