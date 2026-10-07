import { describe, expect, it } from 'vitest';
import { isReference, scrubError, scrubText } from './scrub';

/**
 * Each vector: the input, the sentinels that must be gone, and what the scrubbed text must still
 * say (so the rules do not simply erase everything).
 */
const VECTORS: { name: string; input: string; gone: string[]; kept?: string[] }[] = [
  {
    name: 'an e-mail',
    input: 'could not invite isabelle.tremblay@demo.lynx.test today',
    gone: ['isabelle', 'tremblay@'],
    kept: ['could not invite [courriel] today'],
  },
  {
    name: 'an accented e-mail',
    input: 'sent to élodie.côté+test@conseil-ecole.on.ca',
    gone: ['élodie', 'côté', 'conseil-ecole'],
    kept: ['[courriel]'],
  },
  {
    name: 'a phone with dashes',
    input: 'call 613-555-0142 now',
    gone: ['555-0142'],
    kept: ['call [téléphone] now'],
  },
  {
    name: 'a phone in parentheses',
    input: 'office (613) 555-0199',
    gone: ['555-0199'],
    kept: ['[téléphone]'],
  },
  {
    name: 'a phone with +1 and spaces',
    input: 'tel +1 819 555 0123.',
    gone: ['819', '0123'],
    kept: ['tel [téléphone].'],
  },
  { name: 'a phone with dots', input: 'at 416.555.0177', gone: ['0177'], kept: ['[téléphone]'] },
  { name: 'a local phone', input: 'poste 555-0100', gone: ['0100'], kept: ['[téléphone]'] },
  {
    name: 'a phone without separators',
    input: 'sms 6135550100 sent',
    gone: ['6135550100'],
    kept: ['sms [nombre] sent'],
  },
  {
    name: 'a postal code with a space',
    input: 'lives at K1A 0B1, Ottawa',
    gone: ['K1A', '0B1'],
    kept: ['[code postal]'],
  },
  { name: 'a postal code without space', input: 'code m5v3l9', gone: ['m5v3l9'] },
  {
    name: 'an Ontario Education Number (9 digits)',
    input: 'OEN 123456789 is invalid',
    gone: ['123456789'],
    kept: ['OEN [nombre] is invalid'],
  },
  {
    name: 'a health card number',
    input: 'card 1234-567-890-AB',
    gone: ['1234', '567-890', 'AB'],
    kept: ['[nombre]'],
  },
  {
    name: 'a health card with spaces',
    input: 'card 4321 765 098',
    gone: ['4321', '098'],
    kept: ['[nombre]'],
  },
  { name: 'a long digit run', input: 'n=98765432101234', gone: ['98765432101234'] },
  {
    name: 'a UUID is kept',
    input: 'class 0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b not found',
    gone: [],
    kept: ['class 0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b not found'],
  },
  {
    name: 'a JWT',
    input:
      'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U expired',
    gone: ['eyJhbGci', 'dozjgNry'],
    kept: ['[jeton]', 'expired'],
  },
  {
    name: 'a Bearer header',
    input: 'Authorization: Bearer sk-live-0123abcdXYZ',
    gone: ['sk-live', '0123abcd'],
    kept: ['[jeton]'],
  },
  {
    name: 'a hex secret',
    input: 'key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 bad',
    gone: ['9f86d081884c7d65'],
    kept: ['[secret]', 'bad'],
  },
  {
    name: 'a base64 secret',
    input: 'with 1:Q2xhc3NQb3J0YWxLZXlGb3JUZXN0c09ubHkxMjM0NTY3OA== loaded',
    gone: ['Q2xhc3NQb3J0YWxLZXlG'],
    kept: ['[secret]', 'loaded'],
  },
  {
    name: 'a token in a pair',
    input: 'verify failed token_hash=pkce_8f7a6b5c4d and otp: 123456',
    gone: ['pkce_8f7a6b5c4d', '123456'],
    kept: ['token_hash=[…]', 'otp: […]'],
  },
  {
    name: "Postgres' Key (…)=(…) with an e-mail",
    input:
      'duplicate key value violates unique constraint "users_email_key": Key (email)=(sophie.lavoie@demo.lynx.test) already exists.',
    gone: ['sophie', 'lavoie', 'users_email_key'],
    kept: ['Key (email)=(…) already exists.'],
  },
  {
    name: "Postgres' Key (…)=(…) with a name and parentheses",
    input: 'Key (class_id, first_name)=(4f1c, Léa (jumelle)) conflicts with existing key',
    gone: ['Léa', 'jumelle'],
    kept: ['Key (class_id, first_name)=(…) conflicts with existing key'],
  },
  {
    name: "Postgres' Key (…)=(…) cut short",
    input: 'Key (first_name)=(Nathan',
    gone: ['Nathan'],
    kept: ['Key (first_name)=(…)'],
  },
  {
    name: 'a failing row',
    input:
      'new row violates check constraint; Failing row contains (1, Zoé, allergie aux arachides).',
    gone: ['Zoé', 'arachides'],
    kept: ['Failing row contains (…)'],
  },
  {
    name: 'invalid input syntax for a uuid',
    input: 'invalid input syntax for type uuid: "adam@ecole.ca"',
    gone: ['adam', 'ecole.ca'],
    kept: ['invalid input syntax for type uuid: "…"'],
  },
  {
    name: 'double quotes',
    input: 'unit "Les fractions avec Samuel" is locked',
    gone: ['Samuel', 'fractions'],
    kept: ['unit "…" is locked'],
  },
  {
    name: 'single quotes, apostrophes kept',
    input: "Cannot read properties of undefined (reading 'Aïcha') in l'élève",
    gone: ['Aïcha'],
    kept: ["(reading '…') in l'élève"],
  },
  {
    name: 'guillemets',
    input: 'titre « Lecture avec Emma » refusé',
    gone: ['Emma', 'Lecture'],
    kept: ['titre « … » refusé'],
  },
  { name: 'curly quotes', input: 'note “Mia est absente”', gone: ['Mia'], kept: ['“…”'] },
  { name: 'backticks', input: 'value `Gabriel` invalid', gone: ['Gabriel'], kept: ['`…`'] },
  {
    name: 'a quotation cut short',
    input: 'message "Olivia a oublié son',
    gone: ['Olivia'],
    kept: ['message "…'],
  },
  {
    name: 'a URL query',
    input: 'GET https://ecole.example.ca/auth/confirm?token_hash=abc&type=email failed',
    gone: ['token_hash', 'abc', 'type=email'],
    kept: ['GET https://ecole.example.ca/auth/confirm failed'],
  },
  {
    name: 'a fragment with a code',
    input: 'opened /suppleance#code=K7P2QX9M from a link',
    gone: ['K7P2QX9M'],
    kept: ['opened /suppleance from a link'],
  },
  {
    name: 'a path with a query',
    input: 'redirect to /login?next=%2Fclasses%2Fx',
    gone: ['next=', 'classes'],
    kept: ['redirect to /login'],
  },
  {
    name: 'a mailto link',
    input: 'mailto:julie@ecole.ca?subject=Code&body=Bonjour',
    gone: ['julie', 'Bonjour', 'subject'],
  },
  {
    name: 'control characters',
    input: 'a\u0000b\u0007c',
    gone: ['\u0000', '\u0007'],
    kept: ['a b c'],
  },
];

describe('scrubText', () => {
  it('has at least 30 vectors', () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(30);
  });

  for (const vector of VECTORS) {
    it(`removes ${vector.name}`, () => {
      const out = scrubText(vector.input);
      for (const sentinel of vector.gone) expect(out, out).not.toContain(sentinel);
      for (const text of vector.kept ?? []) expect(out).toContain(text);
    });
  }

  it('keeps ordinary text, codes and counts', () => {
    expect(scrubText('job dispatch_outbox failed after 3 attempts (42501)')).toBe(
      'job dispatch_outbox failed after 3 attempts (42501)',
    );
    expect(scrubText('connect ECONNREFUSED 127.0.0.1:54322')).toBe(
      'connect ECONNREFUSED 127.0.0.1:54322',
    );
  });

  it('cuts to the maximum length', () => {
    const out = scrubText('mot '.repeat(500), 100);
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
    expect(scrubText('short', 100)).toBe('short');
  });

  it('accepts anything', () => {
    expect(scrubText(undefined)).toBe('');
    expect(scrubText(null)).toBe('');
    expect(scrubText(42)).toBe('42');
  });

  it('is stable when run twice', () => {
    for (const vector of VECTORS) {
      const once = scrubText(vector.input);
      expect(scrubText(once)).toBe(once);
    }
  });

  it('stays fast on hostile input', () => {
    const started = performance.now();
    scrubText(`${'"a'.repeat(5000)}${'Key (x)=('.repeat(500)}${'1-'.repeat(5000)}`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('isReference', () => {
  it('accepts digests and browser references only', () => {
    expect(isReference('2338285476')).toBe(true);
    expect(isReference('1234567890@E394')).toBe(true);
    expect(isReference('k3x9a0bq')).toBe(true);
    expect(isReference('K3X9A0BQ')).toBe(false);
    expect(isReference('isabelle@x.ca')).toBe(false);
    expect(isReference('NEXT_REDIRECT;replace;/login;307;')).toBe(false);
    expect(isReference('')).toBe(false);
    expect(isReference(12345678)).toBe(false);
  });
});

/** The shape of `@lynx/ai`'s PrivacyViolation: its own `findings` hold the names it found. */
class PrivacyViolation extends Error {
  constructor(readonly findings: readonly { kind: string; match: string }[]) {
    super(`refusing to send personal information (${findings.map((f) => f.kind).join(', ')})`);
    this.name = 'PrivacyViolation';
  }
}

describe('scrubError', () => {
  it("never reads an error's own properties", () => {
    const error = new PrivacyViolation([
      { kind: 'name', match: 'Léa' },
      { kind: 'email', match: 'lea.parent@courriel.ca' },
    ]);
    const json = JSON.stringify(scrubError(error));
    expect(json).not.toContain('Léa');
    expect(json).not.toContain('lea.parent');
    expect(json).not.toContain('findings');
    expect(scrubError(error)).toMatchObject({
      name: 'PrivacyViolation',
      message: 'refusing to send personal information (name, email)',
    });
  });

  it('keeps a SQLSTATE, a digest and the frames', () => {
    const error = Object.assign(new Error('permission denied for table "students"'), {
      code: '42501',
      digest: '2338285476',
      detail: 'Failing row contains (Samuel)',
      hint: 'samuel@ecole.ca',
    });
    const out = scrubError(error);
    expect(out.name).toBe('Error');
    expect(out.code).toBe('42501');
    expect(out.digest).toBe('2338285476');
    expect(out.message).toBe('permission denied for table "…"');
    expect(out.frames.length).toBeGreaterThan(0);
    expect(out.frames.length).toBeLessThanOrEqual(30);
    expect(JSON.stringify(out)).not.toMatch(/Samuel|samuel|detail|hint/);
  });

  it('drops codes and digests of the wrong shape', () => {
    const error = Object.assign(new Error('x'), {
      code: 'isabelle@ecole.ca',
      digest: 'NEXT_REDIRECT;/login?next=x',
      name: 'Name with spaces',
    });
    const out = scrubError(error);
    expect(out.code).toBeUndefined();
    expect(out.digest).toBeUndefined();
    expect(out.name).toBe('Error');
    expect(scrubError(Object.assign(new Error('x'), { code: 'PGRST116' })).code).toBeUndefined();
  });

  it('makes frames relative to the repository and keeps at most 30', () => {
    const error = new Error('deep');
    error.stack = [
      'Error: deep with sophie@ecole.ca',
      '    at load (/home/mike/schoolapp/apps/web/.next/server/chunks/ssr/page.js:1:200)',
      '    at run (file:///srv/app/packages/ai/src/run.ts:10:5)',
      '    at x (/srv/app/node_modules/.pnpm/next@16/node_modules/next/dist/server/a.js:3:1)',
      '    at y (/home/mike/other/tool.js?v=3:1:1)',
      '    at z (/app/apps/web/.next/standalone/node_modules/.pnpm/next@16.3.6_react@19.3.0/node_modules/next/dist/a.js:5:1)',
      '    at /app/apps/web/.next/standalone/apps/web/.next/server/chunks/x.js:1:2',
      ...Array.from({ length: 40 }, (_, i) => `    at f${i} (apps/worker/src/x.ts:${i}:1)`),
    ].join('\n');
    const out = scrubError(error);
    expect(out.frames).toHaveLength(30);
    expect(out.frames.slice(0, 6)).toEqual([
      'at load (apps/web/.next/server/chunks/ssr/page.js:1:200)',
      'at run (packages/ai/src/run.ts:10:5)',
      'at x (node_modules/next/dist/server/a.js:3:1)',
      'at y (~/other/tool.js:1:1)',
      'at z (node_modules/next/dist/a.js:5:1)',
      'at apps/web/.next/server/chunks/x.js:1:2',
    ]);
    expect(JSON.stringify(out)).not.toContain('sophie');
    expect(JSON.stringify(out)).not.toContain('mike');
  });

  it('copes with values that are not errors', () => {
    expect(scrubError('failed for zoe@ecole.ca')).toEqual({
      name: 'Error',
      message: 'failed for [courriel]',
      frames: [],
    });
    expect(scrubError(undefined)).toEqual({ name: 'Error', message: '', frames: [] });
    const supabaseError = { message: 'Key (email)=(a@b.ca) already exists', code: '23505' };
    expect(scrubError(supabaseError)).toEqual({
      name: 'Error',
      code: '23505',
      message: 'Key (email)=(…) already exists',
      frames: [],
    });
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(scrubError(hostile)).toEqual({ name: 'Error', message: '', frames: [] });
  });
});
