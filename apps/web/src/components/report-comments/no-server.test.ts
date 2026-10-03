import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * « Bulletins » composes report card comments in the browser only (DECISIONS D-130): no server
 * action, route handler or request may carry them. These files (and the device draft's hook) must
 * not import a server action or a `'use server'` module, must not call the network themselves,
 * and the comment and notes fields carry no `name` (so no form could send them).
 */
const here = new URL('.', import.meta.url).pathname;
const src = join(here, '..', '..');
const files = [
  ...readdirSync(here)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => join(here, f)),
  join(src, 'hooks', 'use-report-draft.ts'),
];

/** The modules a file imports, resolved for `@/` and relative paths. */
function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(src, spec.slice(2))
    : spec.startsWith('.')
      ? join(from, '..', spec)
      : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

describe('the composer never reaches the server (D-130)', () => {
  it('has the files this test reads', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const name = file.slice(src.length + 1);
    it(`${name} imports no server action and makes no request`, () => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/['"]use server['"]/);
      expect(text).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/);
      for (const spec of imports(file)) {
        expect(spec, spec).not.toMatch(/^@\/server\/(actions|queries)\b/);
        expect(spec, spec).not.toMatch(/^next\/(server|headers)$/);
        const target = resolve(file, spec);
        if (target) {
          const imported = readFileSync(target, 'utf8');
          expect(imported, `${spec}: 'use server'`).not.toMatch(/^['"]use server['"]/m);
          expect(imported, `${spec}: server-only`).not.toMatch(/import ['"]server-only['"]/);
        }
      }
    });
  }

  it('puts no name on a comment or notes field', () => {
    for (const f of ['comment-field.tsx', 'student-editor.tsx']) {
      const text = readFileSync(join(here, f), 'utf8');
      for (const area of text.match(/<Textarea[\s\S]*?\/>/g) ?? []) {
        expect(area, f).not.toMatch(/\bname=/);
      }
    }
  });
});
