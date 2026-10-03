import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { scrubError, scrubText } from './scrub';

/**
 * The scrubber on real error texts (Phase 6 security review): each sample below was produced by
 * the local stack (PostgreSQL, PostgREST, Supabase Auth, the worker) with the demo data, word for
 * word, so the rules are checked against what the services really say, not only against
 * hand-made vectors (scrub.test.ts). Whatever names or reaches a person must be gone; what makes
 * the line useful (the constraint, the SQLSTATE, the ids) must stay.
 */
const SAMPLES: { source: string; text: string; gone: string[]; kept: string[] }[] = [
  {
    source: 'PostgreSQL, a duplicate address (message and DETAIL)',
    text:
      'duplicate key value violates unique constraint "users_email_key"\n' +
      'Key (email)=(isabelle.tremblay@demo.lynx.test) already exists.',
    gone: ['isabelle', 'tremblay', 'demo.lynx.test'],
    kept: ['duplicate key value violates unique constraint', 'Key (email)=(…) already exists.'],
  },
  {
    source: 'PostgreSQL, a first name where an id was expected',
    text: 'invalid input syntax for type uuid: "Léa"',
    gone: ['Léa'],
    kept: ['invalid input syntax for type uuid: "…"'],
  },
  {
    source: 'PostgreSQL, a check constraint with the failing row',
    text:
      'new row for relation "students" violates check constraint "students_first_name_check"\n' +
      'Failing row contains (7cb01fe2-6a42-4bcb-b08b-7531d47ef935, e0000000-0000-4000-8000-000000000003, ' +
      'Samuel Tremblay-Gagnon de la grande rivière qui coule, null, t, null, ' +
      '2026-10-02 09:58:24.798715+00, 2026-10-02 09:58:24.798715+00).',
    gone: ['Samuel', 'Tremblay-Gagnon', 'rivière', '7cb01fe2'],
    kept: ['violates check constraint', 'Failing row contains (…)'],
  },
  {
    source: 'PostgreSQL, a role row (ids only, still blanked: a row can hold anything)',
    text:
      'new row for relation "user_roles" violates check constraint "user_roles_check"\n' +
      'Failing row contains (71c26603-6648-4e3b-b266-e7ddca2c83e9, d0000000-0000-4000-8000-000000000001, ' +
      'teacher, 00000000-0000-0000-0000-000000000000, null, 2026-10-02 09:58:15.728885+00, null).',
    gone: ['71c26603', 'teacher,'],
    kept: ['Failing row contains (…)'],
  },
  {
    source: 'PostgREST, the error object printed whole',
    text:
      '{"code":"23514","details":"Failing row contains (7cb01fe2-6a42-4bcb-b08b-7531d47ef935, ' +
      'e0000000-0000-4000-8000-000000000003, Samuel Tremblay-Gagnon de la grande rivière qui coule, ' +
      'null, t, null, 2026-10-02 09:58:24.798715+00, 2026-10-02 09:58:24.798715+00).","hint":null,' +
      '"message":"new row for relation \\"students\\" violates check constraint \\"students_first_name_check\\""}',
    gone: ['Samuel', 'Tremblay-Gagnon', 'rivière'],
    // Every quoted value goes, keys included: the line keeps the error's own fields elsewhere.
    kept: ['{"…":"…"'],
  },
  {
    source: 'PostgREST, a duplicate profile id',
    text: 'duplicate key value violates unique constraint "users_pkey" Key (id)=(d0000000-0000-4000-8000-000000000001) already exists.',
    gone: [],
    kept: ['Key (id)=(…) already exists.'],
  },
  {
    source: 'Supabase Auth, an existing account',
    text: '{"code":422,"error_code":"email_exists","msg":"A user with this email address has already been registered"}',
    gone: [],
    kept: ['422'],
  },
  {
    source: 'Supabase Auth, a sign-in link followed by a mail scanner',
    text: 'GET https://app.example.ca/auth/v1/verify?token=482913&type=magiclink&redirect_to=https%3A%2F%2Fapp.example.ca%2Ftoday failed with 403',
    gone: ['482913', 'magiclink', 'redirect_to'],
    kept: ['GET https://app.example.ca/auth/v1/verify failed with 403'],
  },
  {
    source: 'the worker, a job that failed (graphile-worker)',
    text: "Failed task 215 (handle_event, 63.29ms, attempt 1 of 10) with error 'absence not found':",
    gone: [],
    kept: ['Failed task 215 (handle_event, 63.29ms, attempt 1 of 10)'],
  },
  {
    source: 'the portal pool, a wrong password',
    text: 'password authentication failed for user "lynx_sub_portal"',
    gone: ['lynx_sub_portal'],
    kept: ['password authentication failed for user'],
  },
  {
    source: 'a validation error printed whole (Zod)',
    text: '[{"origin":"string","code":"invalid_format","format":"email","path":["email"],"message":"Invalid email address","input":"julie.bergeron@demo.lynx.test"}]',
    gone: ['julie', 'bergeron', 'demo.lynx.test'],
    kept: [],
  },
  {
    // A first name in free text cannot be recognized (D-111, a known limit): that is why errors
    // never carry what people typed, browsers send a hash of their message, and scrubError never
    // reads an error's other fields. Every detail that has a shape goes.
    source: 'free text that reached an error by mistake (its name stays: the known limit)',
    text: 'Le parent de Samuel a appelé au 613 555 0199, il habite au K1A 0B1; carte santé 1234-567-890-AB, NISO 123456789.',
    gone: ['613 555 0199', 'K1A 0B1', '1234-567-890', '123456789'],
    kept: ['Le parent de Samuel', '[téléphone]', '[code postal]', '[nombre]'],
  },
  {
    source: 'a service key in a failed request line',
    text: 'request to http://api-gateway:8000/rest/v1/ failed: apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcDEF123 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig',
    gone: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'abcDEF123', 'eyJzdWIiOiJ4In0'],
    kept: ['request to http://api-gateway:8000/rest/v1/ failed'],
  },
];

describe('the scrubber on real error texts', () => {
  for (const sample of SAMPLES) {
    it(sample.source, () => {
      const out = scrubText(sample.text, 2000);
      for (const gone of sample.gone) expect(out, `${sample.source}: ${gone}`).not.toContain(gone);
      expect(out).not.toMatch(/@[a-z-]+\.[a-z]{2,}/i);
      for (const kept of sample.kept) expect(out, `${sample.source}: ${kept}`).toContain(kept);
    });
  }

  it('the same texts as errors, through a log line', () => {
    const lines: string[] = [];
    const logger = createLogger('review', {
      component: 'web',
      release: 'test',
      write: (line) => lines.push(line),
    });
    for (const sample of SAMPLES.filter((s) => !s.source.startsWith('free text'))) {
      const error = Object.assign(new Error(sample.text), {
        code: '23505',
        // A PostgREST error's other fields, which a log must never read.
        details: sample.text,
        hint: 'Samuel Tremblay-Gagnon',
      });
      logger.error('request failed', { error });
      logger.error('request failed', { error: scrubError(error), note: sample.text });
    }
    const all = lines.join('\n');
    for (const word of ['Samuel', 'Tremblay', 'isabelle', 'julie', 'Léa', '613 555', '482913']) {
      expect(all).not.toContain(word);
    }
    expect(all).not.toMatch(/@demo\.lynx\.test/);
  });
});
