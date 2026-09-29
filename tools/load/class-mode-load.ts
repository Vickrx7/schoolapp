/**
 * Load check for « Quiz sur les appareils » (DECISIONS D-083, D-085; Phase 5 plan H5): one class
 * of simulated devices plays a quiz over HTTP against a running web server, the way tablets do.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     pnpm exec tsx tools/load/class-mode-load.ts --base http://localhost:3000 [--devices 30] \
 *     [--questions 5] [--class <uuid>] [--teacher <uuid>] [--item <uuid>] [--network-per-device]
 *
 * - The teacher's side (start, « Commencer », « Afficher la réponse », « Question suivante »,
 *   « Terminer la séance ») and the projector's poll every second run in the database as the
 *   teacher (her JWT claims, as PostgREST sets them); the devices use the web server's device API
 *   only (`/jouer/api/join`, `state`, `answer`), each with its own cookies.
 * - Every device polls `GET /jouer/api/state?v=…` every 1.5 s ± 250 ms, answers each question
 *   after 0.5 to 4 s, and backs off as the page does (Retry-After on 503, 5 s after an error).
 * - At the end the session is ended without keeping results, the script checks that no answer or
 *   device is left, and deletes the session.
 *
 * It prints latency percentiles per endpoint, status counts and requests per second. The numbers
 * are recorded (docs/phase-5.md), not a gate: a shared container is noisy. The default class is
 * Marc Gagnon's 5e année (seeded), whose open session, if any, is replaced.
 */
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
    devices: { type: 'string', default: '30' },
    questions: { type: 'string', default: '5' },
    class: { type: 'string', default: 'e0000000-0000-4000-8000-000000000005' },
    teacher: { type: 'string', default: 'd0000000-0000-4000-8000-000000000002' },
    // Seeded demo pack: « Quiz : les nombres jusqu’à 1 000 » (9 questions).
    item: { type: 'string', default: '7bdc7066-9b8a-5125-8351-bf234b0b11d3' },
    // One X-Forwarded-For address per device (otherwise they share one, as behind a school NAT).
    'network-per-device': { type: 'boolean', default: false },
  },
});

const BASE = new URL(args.base!).origin;
const DEVICES = Number(args.devices);
const QUESTIONS = Number(args.questions);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

// ---------------------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------------------

type Endpoint = 'join' | 'state' | 'answer' | 'projector';
const latencies: Record<Endpoint, number[]> = { join: [], state: [], answer: [], projector: [] };
const statuses: Record<Endpoint, Map<string, number>> = {
  join: new Map(),
  state: new Map(),
  answer: new Map(),
  projector: new Map(),
};
const count = (endpoint: Endpoint, status: string) =>
  statuses[endpoint].set(status, (statuses[endpoint].get(status) ?? 0) + 1);

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// ---------------------------------------------------------------------------------------
// The teacher, in the database
// ---------------------------------------------------------------------------------------

const admin = new pg.Pool({ connectionString: databaseUrl, max: 2 });

async function asTeacher<T>(sql: string, params: unknown[]): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: args.teacher, role: 'authenticated' }), args.teacher],
    );
    const { rows } = await client.query(sql, params);
    await client.query('commit');
    return rows[0] as T;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

interface Live {
  version: number;
  phase: string;
  index: number;
  total: number;
  answered: number;
  devices: { count: number; connected: number };
}

const live = async (sessionId: string) =>
  (await asTeacher<{ s: Live }>('select public.class_session_live($1) as s', [sessionId])).s;
const control = async (sessionId: string, action: string, version: number) =>
  (
    await asTeacher<{ s: Live }>('select public.class_session_control($1, $2, $3) as s', [
      sessionId,
      action,
      version,
    ])
  ).s;

// ---------------------------------------------------------------------------------------
// A device, over HTTP
// ---------------------------------------------------------------------------------------

interface Question {
  kind: string;
  choices?: { id: string }[];
  left?: { id: string }[];
  right?: { id: string }[];
  items?: { id: string }[];
}

interface DeviceView {
  status: string;
  version?: number;
  session?: { phase: string; index: number };
  question?: Question | null;
  myAnswer?: unknown;
}

class Device {
  private cookies = new Map<string, string>();
  version: number | null = null;
  answered = new Set<number>();
  errors = 0;
  gone = false;

  constructor(private readonly n: number) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (args['network-per-device']) headers['X-Forwarded-For'] = `198.51.100.${this.n}`;
    return headers;
  }

  private keepCookies(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }

  private async call(endpoint: Endpoint, path: string, body?: unknown) {
    const started = performance.now();
    try {
      const response = await fetch(`${BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: this.headers(
          body === undefined ? {} : { 'Content-Type': 'application/json', Origin: BASE },
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      latencies[endpoint].push(performance.now() - started);
      count(endpoint, String(response.status));
      this.keepCookies(response);
      return { status: response.status, json, retryAfter: response.headers.get('retry-after') };
    } catch {
      latencies[endpoint].push(performance.now() - started);
      count(endpoint, 'network');
      this.errors += 1;
      return { status: 0, json: null, retryAfter: null };
    }
  }

  async join(code: string): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { status, json, retryAfter } = await this.call('join', '/jouer/api/join', { code });
      if (json?.outcome === 'ok') return true;
      if (status === 503) await sleep(Number(retryAfter ?? 2) * 1000);
      else return false;
    }
    return false;
  }

  /** Polls until the session ends for this device; answers each question once. */
  async play(stop: () => boolean) {
    while (!stop() && !this.gone) {
      const v = this.version === null ? '' : `?v=${this.version}`;
      const { status, json, retryAfter } = await this.call('state', `/jouer/api/state${v}`);
      let delay = jitter(1250, 1750);
      if (status === 503) delay = Number(retryAfter ?? 2) * 1000;
      else if (status !== 200 || !json) {
        delay = 5000;
      } else {
        const view = json as unknown as DeviceView;
        if (view.status === 'gone' || view.status === 'ended') {
          this.gone = true;
          break;
        }
        if (view.status === 'ok') {
          this.version = view.version ?? this.version;
          const index = view.session?.index ?? -1;
          if (view.session?.phase === 'question' && view.question && !this.answered.has(index)) {
            this.answered.add(index);
            void this.answerLater(index, view.question);
          }
        }
      }
      await sleep(delay);
    }
  }

  private async answerLater(index: number, question: Question) {
    await sleep(jitter(500, 4000));
    const pick = <T>(list: T[] | undefined) => list?.[Math.floor(Math.random() * list.length)];
    const response =
      question.kind === 'multiple_choice'
        ? { choiceIds: [pick(question.choices)!.id] }
        : question.kind === 'true_false'
          ? { value: Math.random() < 0.7 }
          : question.kind === 'matching'
            ? {
                pairs: Object.fromEntries(
                  (question.left ?? []).map((l) => [l.id, pick(question.right)!.id]),
                ),
              }
            : question.kind === 'ordering'
              ? { orderedIds: (question.items ?? []).map((i) => i.id).reverse() }
              : { text: 'mille' };
    for (let attempt = 0; attempt < 5; attempt++) {
      const { status, retryAfter } = await this.call('answer', '/jouer/api/answer', {
        index,
        kind: question.kind,
        response,
      });
      if (status === 503) await sleep(Number(retryAfter ?? 2) * 1000);
      else if (status === 0 || status >= 500) await sleep(1000 * (attempt + 1));
      else return;
    }
  }
}

// ---------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------

async function main() {
  console.log(`Class-mode load: ${DEVICES} devices, ${QUESTIONS} questions, ${BASE}`);
  const started = await asTeacher<{ session_id: string; join_code: string }>(
    `select * from public.start_class_session($1, $2, null, 'teams', 4::smallint, 'random', null,
       true, false, true)`,
    [args.class, args.item],
  );
  const sessionId = started.session_id;
  const runStarted = performance.now();
  let done = false;
  let projectorPolls = 0;

  // The projector polls every second.
  const projector = (async () => {
    while (!done) {
      const t0 = performance.now();
      try {
        await live(sessionId);
        count('projector', 'ok');
      } catch {
        count('projector', 'error');
      }
      latencies.projector.push(performance.now() - t0);
      projectorPolls += 1;
      await sleep(1000);
    }
  })();

  try {
    const devices = Array.from({ length: DEVICES }, (_, i) => new Device(i + 1));
    const joined = await Promise.all(
      devices.map(async (d, i) => {
        await sleep(i * 50);
        return d.join(started.join_code);
      }),
    );
    const joinedCount = joined.filter(Boolean).length;
    console.log(`joined: ${joinedCount}/${DEVICES}`);
    const playing = devices.filter((_, i) => joined[i]).map((d) => d.play(() => done));

    await sleep(3000);
    let state = await live(sessionId);
    const questions = Math.min(QUESTIONS, state.total);
    for (let q = 0; q < questions; q++) {
      state = await control(sessionId, 'next', state.version);
      // Wait until every device answered, or 20 s.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        state = await live(sessionId);
        if (state.answered >= joinedCount) break;
        await sleep(500);
      }
      console.log(`question ${q + 1}: ${state.answered}/${joinedCount} answers`);
      state = await control(sessionId, 'reveal', state.version);
      await sleep(3000);
      if (q < questions - 1) state = await control(sessionId, 'leaderboard', state.version);
      await sleep(1500);
    }
    state = await control(sessionId, 'finish', state.version);
    await sleep(3000);
    const ended = await asTeacher<{ s: { responsesDeleted: number; participantsDeleted: number } }>(
      'select public.end_class_session($1, false) as s',
      [sessionId],
    );
    console.log(
      `ended: ${ended.s.responsesDeleted} answers and ${ended.s.participantsDeleted} devices deleted`,
    );
    // Devices see « gone » at their next poll and stop.
    await Promise.race([Promise.all(playing), sleep(8000)]);
  } finally {
    done = true;
    await projector;
    const left = await admin.query<{ n: string }>(
      `select (select count(*) from public.session_responses where session_id = $1)
            + (select count(*) from public.session_participants where session_id = $1) as n`,
      [sessionId],
    );
    await admin.query('delete from public.class_sessions where id = $1', [sessionId]);
    await admin.end();
    const seconds = (performance.now() - runStarted) / 1000;
    report(seconds, projectorPolls, Number(left.rows[0]?.n ?? -1));
  }
}

function report(seconds: number, projectorPolls: number, leftOver: number) {
  const rows = (Object.keys(latencies) as Endpoint[]).map((endpoint) => {
    const sorted = [...latencies[endpoint]].sort((a, b) => a - b);
    return {
      endpoint,
      requests: sorted.length,
      p50: percentile(sorted, 50).toFixed(1),
      p95: percentile(sorted, 95).toFixed(1),
      p99: percentile(sorted, 99).toFixed(1),
      max: (sorted[sorted.length - 1] ?? NaN).toFixed(1),
      statuses: Object.fromEntries(statuses[endpoint]),
    };
  });
  const http = rows.filter((r) => r.endpoint !== 'projector').reduce((n, r) => n + r.requests, 0);
  console.log('\nLatency in ms (projector: class_session_live in the database):');
  console.table(rows.map((r) => ({ ...r, statuses: JSON.stringify(r.statuses) })));
  console.log(
    `duration ${seconds.toFixed(1)} s · device HTTP requests ${http} (${(http / seconds).toFixed(1)}/s)` +
      ` · projector polls ${projectorPolls} · answers or devices left after the end: ${leftOver}`,
  );
  if (leftOver !== 0) process.exitCode = 1;
}

await main();
