/**
 * Database helpers of the « Quiz sur les appareils » specs (Phase 5, DECISIONS D-084 to D-089):
 * the battle quiz (the same shape as the pgTAP fixture `tests.battle_quiz`), the class link,
 * sessions started or moved on as a demo teacher (her JWT claims, as PostgREST sets them), counts
 * after the end, and clean-up. As the database owner (DATABASE_URL), like `db.ts`.
 */
import pg from 'pg';
import { SEED, insertReadyItem, query } from './db';

// Teacher calls need their own transaction (claims set with set_config(…, true)): a small pool of
// their own, closed by closeClassModeDb() in afterAll.
let pool: pg.Pool | null = null;
function teacherPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    max: 1,
  });
  return pool;
}

export async function closeClassModeDb(): Promise<void> {
  const open = pool;
  pool = null;
  await open?.end();
}

/** The battle quiz's questions: every kind a device answers, in this order. */
export const BATTLE = {
  q1: { prompt: 'Quel nombre vient juste après 999?', right: '1 000', wrong: '1 001' },
  q2: { prompt: '500 est plus grand que 499.' },
  q3: { prompt: 'Associe chaque nombre en lettres au même nombre en chiffres.' },
  q4: { prompt: 'Place ces nombres du plus petit au plus grand.' },
  q5: { prompt: 'Écris « mille » en chiffres.' },
} as const;

/**
 * A quiz for class devices, as `tests.battle_quiz` in the database tests: 5 questions (multiple
 * choice « 1 000 » right; true or false, true; matching cent→100, mille→1 000, dix→10 with an
 * extra option; ordering 100, 500, 900; a short answer accepting « 1 000 »). The sentinel is in
 * every display field of the key, the solution, the teacher's note, and fields a whitelist must
 * drop (an « answer » inside a question, a « correct » inside an option). 3e année, private to its
 * author (a teacher's own draft can be played, D-084). Returns the item's id.
 */
export async function insertBattleQuiz(options: {
  author: string;
  title: string;
  sentinel: string;
}): Promise<string> {
  const { sentinel } = options;
  const itemId = await insertReadyItem({
    author: options.author,
    type: 'quiz',
    title: options.title,
  });
  const content = {
    title: '',
    objective: 'Je lis et je compare des nombres jusqu’à 1 000.',
    teacherNote: `${sentinel} : les réponses sont c2, vrai, l1-rc.`,
    instructions: 'Lis chaque question.',
    questions: [
      {
        id: 'q1',
        kind: 'multiple_choice',
        prompt: BATTLE.q1.prompt,
        hint: '',
        points: null,
        category: 'connaissance',
        multipleAnswers: false,
        answer: sentinel,
        choices: [
          { id: 'c1', text: '990' },
          { id: 'c2', text: '1 000' },
          { id: 'c3', text: '1 001' },
          { id: 'c4', text: '9 999' },
        ],
      },
      {
        id: 'q2',
        kind: 'true_false',
        prompt: BATTLE.q2.prompt,
        hint: '',
        points: null,
        category: null,
      },
      {
        id: 'q3',
        kind: 'matching',
        prompt: BATTLE.q3.prompt,
        hint: '',
        points: null,
        category: null,
        left: [
          { id: 'l1', text: 'cent' },
          { id: 'l2', text: 'mille' },
          { id: 'l3', text: 'dix' },
        ],
        right: [
          { id: 'ra', text: '1 000' },
          { id: 'rb', text: '10' },
          { id: 'rc', text: '100' },
          { id: 'rd', text: '10 000', correct: sentinel },
        ],
      },
      {
        id: 'q4',
        kind: 'ordering',
        prompt: BATTLE.q4.prompt,
        hint: '',
        points: null,
        category: null,
        items: [
          { id: 'i1', text: '500' },
          { id: 'i2', text: '900' },
          { id: 'i3', text: '100' },
        ],
      },
      {
        id: 'q5',
        kind: 'short_answer',
        prompt: BATTLE.q5.prompt,
        hint: '',
        points: null,
        category: null,
        lines: 1,
      },
    ],
  };
  const key = {
    answers: [
      {
        questionId: 'q1',
        kind: 'multiple_choice',
        correctChoiceIds: ['c2'],
        explanation: sentinel,
      },
      { questionId: 'q2', kind: 'true_false', correct: true, explanation: sentinel },
      {
        questionId: 'q3',
        kind: 'matching',
        pairs: [
          { leftId: 'l1', rightId: 'rc' },
          { leftId: 'l2', rightId: 'ra' },
          { leftId: 'l3', rightId: 'rb' },
        ],
        explanation: sentinel,
      },
      { questionId: 'q4', kind: 'ordering', orderedIds: ['i3', 'i1', 'i2'], explanation: sentinel },
      {
        questionId: 'q5',
        kind: 'short_answer',
        sampleAnswer: sentinel,
        acceptableAnswers: ['1 000', sentinel.toLowerCase()],
        explanation: sentinel,
      },
    ],
    solution: sentinel,
  };
  await query(
    `update public.library_item_versions set content = $2::jsonb
     where item_id = $1 and language_level_id is null`,
    [itemId, JSON.stringify(content)],
  );
  await query(
    `update public.library_item_answer_keys k set answer_key = $2::jsonb
     from public.library_item_versions v
     where v.id = k.version_id and v.item_id = $1 and v.language_level_id is null`,
    [itemId, JSON.stringify(key)],
  );
  return itemId;
}

/** Runs one statement as a demo teacher (by e-mail), in its own committed transaction. */
async function asTeacher<T extends Record<string, unknown>>(
  email: string,
  sql: string,
  params: unknown[],
): Promise<T> {
  const client = await teacherPool().connect();
  try {
    await client.query('begin');
    const me = await client.query<{ id: string }>(
      `select id, set_config('request.jwt.claims',
                json_build_object('sub', id, 'role', 'authenticated')::text, true),
              set_config('request.jwt.claim.sub', id::text, true)
       from public.users where email = $1`,
      [email],
    );
    if (!me.rows[0]) throw new Error(`no user ${email}`);
    const { rows } = await client.query<T>(sql, params);
    await client.query('commit');
    return rows[0]!;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A session started as a demo teacher, as « Lancer » does (the database builds the snapshot and
 * the key). Returns its id and code.
 */
export async function startSessionAs(
  email: string,
  options: {
    classId?: string;
    itemId: string;
    mode?: 'teams' | 'solo';
    teams?: number;
    revealAnswers?: boolean;
    replaceOpen?: boolean;
  },
): Promise<{ sessionId: string; code: string }> {
  const row = await asTeacher<{ session_id: string; join_code: string }>(
    email,
    `select s.session_id, s.join_code from public.start_class_session($1::uuid, $2::uuid, null,
       $3::text, $4::smallint, 'random', null, $5::boolean, false, $6::boolean) s`,
    [
      options.classId ?? SEED.class3,
      options.itemId,
      options.mode ?? 'teams',
      options.teams ?? 2,
      options.revealAnswers ?? true,
      options.replaceOpen ?? true,
    ],
  );
  return { sessionId: row.session_id, code: row.join_code };
}

/** One projector control as a demo teacher, with the session's current version. */
export async function controlAs(email: string, sessionId: string, action: string): Promise<void> {
  await asTeacher(
    email,
    `select public.class_session_control($1::uuid, $2::text,
       (select state_version from public.class_sessions where id = $1::uuid)) as state`,
    [sessionId, action],
  );
}

/** The class's link token (« Lien de la classe »), created when the class has none yet. */
export async function classLink(classId: string): Promise<string> {
  const [existing] = await query<{ token: string }>(
    'select token from public.class_mode_links where class_id = $1',
    [classId],
  );
  if (existing) return existing.token;
  const [created] = await query<{ token: string }>(
    `insert into public.class_mode_links (class_id, token)
     values ($1, rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='))
     returning token`,
    [classId],
  );
  return created!.token;
}

/** The open session of a class, if any. */
export async function openSession(classId: string): Promise<string | null> {
  const [row] = await query<{ id: string }>(
    `select id from public.class_sessions where class_id = $1 and status = 'open'`,
    [classId],
  );
  return row?.id ?? null;
}

/** What is left of a session: its devices, answers and kept results. */
export async function classModeCounts(
  sessionId: string,
): Promise<{ participants: number; responses: number; results: number }> {
  const [row] = await query<{ participants: number; responses: number; results: number }>(
    `select (select count(*)::int from public.session_participants where session_id = $1) as participants,
            (select count(*)::int from public.session_responses where session_id = $1) as responses,
            (select count(*)::int from public.class_session_results where session_id = $1) as results`,
    [sessionId],
  );
  return row!;
}

/** Failed joins are shared by every run (they come from 127.0.0.1): start clean. */
export async function clearJoinFailures(): Promise<void> {
  await query('delete from public.class_join_failures');
}

/**
 * Ends the class's open session (answers and devices deleted, as at the end of a class) and
 * deletes the sessions a spec made: those of its own items, and those it lists (a colleague's
 * session of a demo quiz). The seeded kept results stay.
 */
export async function cleanupSessions(
  classId: string,
  made: { itemIds?: string[]; sessionIds?: string[] },
): Promise<void> {
  await query(
    `select app.class_session_close(id, false) from public.class_sessions
     where class_id = $1 and status = 'open'`,
    [classId],
  );
  await query(
    `delete from public.class_sessions
     where library_item_id = any($1::uuid[]) or id = any($2::uuid[])`,
    [made.itemIds ?? [], made.sessionIds ?? []],
  );
}
