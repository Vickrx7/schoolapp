import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  LIBRARY_BUCKETS,
  LIBRARY_ITEM_TYPES,
  subFriendlyAllowed,
  TYPE_INFO,
  typesOf,
  type LibraryItemType,
} from './catalog';
import { QUESTION_LISTS } from './questions-of';

// SPEC 9.3, « Item types, grouped in six buckets ».
const SPEC_BUCKETS: Record<string, LibraryItemType[]> = {
  enseigner: ['lesson_plan', 'anchor_chart', 'worked_example', 'teacher_guide'],
  pratiquer: ['worksheet', 'learning_centre', 'reading_passage', 'vocabulary_bank', 'exit_ticket'],
  explorer: ['experiment', 'stem_challenge', 'project', 'outdoor_activity'],
  evaluer: ['quiz', 'unit_test', 'diagnostic', 'rubric'],
  jouer: ['game', 'brain_break', 'song', 'riddle', 'weekly_challenge'],
  relier: ['catholic_reflection', 'culture_hook', 'parent_guide'],
};

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260928160700_library.sql', import.meta.url),
  'utf8',
);

/** The values of `create type public.<name> as enum (...)`. */
function sqlEnum(name: string): string[] {
  const match = new RegExp(`create type public\\.${name} as enum \\(([^;]*)\\);`).exec(migration);
  return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/** The type → bucket mapping of `app.library_bucket_for`. */
function sqlBuckets(): Record<string, string> {
  const body = /create function app\.library_bucket_for[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
    migration,
  )![1]!;
  const mapping: Record<string, string> = {};
  for (const m of body.matchAll(/when p_type in \(([^)]*)\)\s*then '([a-z]+)'/g)) {
    for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) mapping[t[1]!] = m[2]!;
  }
  const fallback = /else '([a-z]+)'/.exec(body)![1]!;
  for (const type of sqlEnum('library_item_type')) mapping[type] ??= fallback;
  return mapping;
}

describe('catalog', () => {
  it('1. has 25 types and 6 buckets, mapped like SPEC 9.3 and app.library_bucket_for', () => {
    expect(LIBRARY_ITEM_TYPES).toHaveLength(25);
    expect(LIBRARY_BUCKETS).toHaveLength(6);
    expect([...LIBRARY_ITEM_TYPES]).toEqual(sqlEnum('library_item_type'));
    expect([...LIBRARY_BUCKETS]).toEqual(sqlEnum('library_bucket'));
    for (const [bucket, types] of Object.entries(SPEC_BUCKETS)) {
      expect(typesOf(bucket as (typeof LIBRARY_BUCKETS)[number])).toEqual(types);
    }
    const sql = sqlBuckets();
    for (const type of LIBRARY_ITEM_TYPES) expect(bucketOf(type)).toBe(sql[type]);
  });

  it('2. has consistent flags', () => {
    const where = (flag: keyof (typeof TYPE_INFO)[LibraryItemType]) =>
      LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t][flag] === true);
    // keyed ⊂ may have questions; levels for approval ⊂ levelable.
    for (const t of where('keyed')) expect(TYPE_INFO[t].mayHaveQuestions).toBe(true);
    for (const t of where('levelsForApproval')) expect(TYPE_INFO[t].levelable).toBe(true);
    // A type that stores questions may have a key.
    for (const t of Object.keys(QUESTION_LISTS) as LibraryItemType[]) {
      expect(TYPE_INFO[t].mayHaveQuestions).toBe(true);
    }
    // Only experiments and STEM challenges need safety notes.
    expect(where('needsSafety')).toEqual(['experiment', 'stem_challenge']);
    // The SQL readiness lists (plan C1).
    expect(where('keyed').sort()).toEqual(
      ['quiz', 'unit_test', 'diagnostic', 'exit_ticket', 'riddle'].sort(),
    );
    expect(where('levelsForApproval').sort()).toEqual(
      ['reading_passage', 'worksheet', 'exit_ticket', 'quiz'].sort(),
    );
    expect(where('expectationsOptional').sort()).toEqual(
      ['brain_break', 'catholic_reflection', 'culture_hook', 'song'].sort(),
    );
    // The ⊘ set equals the library_items_sub_friendly_allowed constraint.
    expect(LIBRARY_ITEM_TYPES.filter((t) => !TYPE_INFO[t].subFriendlyAllowed).sort()).toEqual(
      ['unit_test', 'diagnostic', 'rubric', 'parent_guide', 'teacher_guide', 'project'].sort(),
    );
    expect(TYPE_INFO.lesson_plan.subFriendlyAllowed).toBe(true);
    // Teacher-only types have no student sheet.
    expect(LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t].audience === 'teacher')).toEqual([
      'lesson_plan',
      'teacher_guide',
    ]);
    for (const t of LIBRARY_ITEM_TYPES) {
      expect(TYPE_INFO[t].defaultDuration).toBeGreaterThanOrEqual(5);
      expect(TYPE_INFO[t].defaultDuration).toBeLessThanOrEqual(240);
    }
  });

  it('allows sub-friendly experiments only under standard supervision', () => {
    expect(subFriendlyAllowed('experiment', { supervision: 'standard' })).toBe(true);
    expect(subFriendlyAllowed('experiment', { supervision: 'close' })).toBe(false);
    expect(subFriendlyAllowed('stem_challenge', null)).toBe(false);
    expect(subFriendlyAllowed('unit_test', null)).toBe(false);
    expect(subFriendlyAllowed('reading_passage', null)).toBe(true);
  });
});
