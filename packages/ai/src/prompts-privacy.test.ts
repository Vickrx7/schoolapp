/**
 * Test A8 (Phase 5): every system prompt passes the last check before sending with a real
 * board's people. `runFeature` checks the system prompt and the message together
 * (`assertSafeOutbound`), so a name written in a fixed prompt (« Hugo », « Maëlle ») would refuse
 * every request of a board where a student has that name, and bulk generation redacts with
 * everyone of the board (DECISIONS D-098). Character names are chosen per request instead,
 * leaving out anyone the request's redactor knows (`characterNamesFor`, D-072).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHARACTER_NAMES } from './features/library-shared';
import { DEMO_PEOPLE } from './fixtures/demo-people';
import { Redactor, type KnownPerson } from './privacy';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const promptsDir = path.join(repo, 'prompts');

/** Every `prompts/<feature>/<version>.md`, relative to `prompts/`. */
function promptFiles(dir = promptsDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return promptFiles(full);
    return entry.name.endsWith('.md') ? [path.relative(promptsDir, full)] : [];
  });
}

/** The students and staff `supabase/seed.sql` creates. */
function seededPeople(): KnownPerson[] {
  const seed = readFileSync(path.join(repo, 'supabase', 'seed.sql'), 'utf8');
  const students = [
    ...seed.matchAll(/insert into public\.students[\s\S]*?\) as s \(first_name, level\);/g),
  ].flatMap((block) =>
    [...block[0].matchAll(/\('([^']+)', '[a-z_]+'\)/g)].map((m) => ({
      name: m[1]!,
      kind: 'student' as const,
    })),
  );
  const staffBlock = /with staff \(id, email, display_name, honorific\) as \([\s\S]*?\n\),/.exec(
    seed,
  );
  const staff = [...(staffBlock?.[0] ?? '').matchAll(/'[^']+@[^']+', '([^']+)', '[^']+'\)/g)].map(
    (m) => ({ name: m[1]!, kind: 'staff' as const }),
  );
  return [...students, ...staff];
}

describe('system prompts and the privacy check', () => {
  it('uses the demo database’s people', () => {
    const seeded = seededPeople();
    expect(seeded.filter((p) => p.kind === 'student')).toHaveLength(40);
    expect(seeded.filter((p) => p.kind === 'staff')).toHaveLength(6);
    const key = (p: KnownPerson) => `${p.kind}:${p.name}`;
    expect(DEMO_PEOPLE.map(key).sort()).toEqual(seeded.map(key).sort());
  });

  const files = promptFiles();

  it('finds every prompt file', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        path.join('differentiate', 'v1.md'),
        path.join('sub_plan', 'v1.md'),
        path.join('library_item', 'v1.md'),
        path.join('library_levels', 'v1.md'),
      ]),
    );
  });

  it.each(files)('%s passes the last check before sending with the demo people', (file) => {
    const text = readFileSync(path.join(promptsDir, file), 'utf8');
    expect(() => new Redactor(DEMO_PEOPLE).assertSafeOutbound(text)).not.toThrow();
  });

  it.each(files)('%s holds no list of character first names', (file) => {
    // The list is sent per request, less the names of people the request knows.
    const text = readFileSync(path.join(promptsDir, file), 'utf8');
    const found = CHARACTER_NAMES.filter((name) =>
      new RegExp(`(^|[^\\p{L}])${name}([^\\p{L}]|$)`, 'u').test(text),
    );
    expect(found).toEqual([]);
  });
});
