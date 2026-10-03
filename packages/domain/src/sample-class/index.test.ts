import { readFileSync } from 'node:fs';
import { frenchStyleProblems, mapStrings } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { isoWeekday, timeToMinutes } from '../dates';
import {
  SAMPLE_FIRST_NAMES,
  SAMPLE_GRADES,
  buildSampleClass,
  sampleClassSchema,
  sampleUnits,
  weekdaysBefore,
  type SampleClassPayload,
} from './index';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-CA');

/** Every prose string of a payload (the strings a person reads). */
function proseStrings(payload: SampleClassPayload): string[] {
  const out: string[] = [payload.name];
  for (const block of payload.blocks) if (block.title) out.push(block.title);
  for (const unit of payload.units) {
    out.push(unit.title);
    if (unit.description) out.push(unit.description);
    for (const lesson of unit.lessons) {
      for (const text of [
        lesson.title,
        lesson.objectives,
        lesson.materials,
        lesson.content,
        lesson.subNotes,
      ]) {
        if (text) out.push(text);
      }
    }
  }
  return out;
}

describe('the sample class (D-109)', () => {
  // A Thursday: the 3 weekdays before it are Monday to Wednesday.
  const today = '2026-11-12';

  it.each(SAMPLE_GRADES)(
    'builds the %se année class as create_sample_class accepts it',
    (grade) => {
      const payload = buildSampleClass({ gradeCode: grade, today });
      expect(sampleClassSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
      expect(payload.name).toBe(`Classe exemple (${grade}e année)`);
      expect(payload.gradeCodes).toEqual([grade]);
      expect(payload.students.map((s) => s.firstName)).toEqual([...SAMPLE_FIRST_NAMES]);
    },
  );

  it('has 20 invented first names, all different, none of the demo database’s people', () => {
    expect(SAMPLE_FIRST_NAMES).toHaveLength(20);
    expect(new Set(SAMPLE_FIRST_NAMES.map(fold)).size).toBe(20);
    const seed = fold(
      readFileSync(new URL('../../../../supabase/seed.sql', import.meta.url), 'utf8'),
    );
    for (const name of SAMPLE_FIRST_NAMES) {
      // A demo student is a `('Léa', 'avance')` row; a staff member a display name.
      expect(seed, name).not.toMatch(new RegExp(`[^\\p{L}]${fold(name)}[^\\p{L}]`, 'u'));
      expect(name).toMatch(/^\p{Lu}\p{Ll}+$/u);
    }
  });

  it('spreads the levels as the demo 3e année does: 3 / 4 / 10 / 3', () => {
    const payload = buildSampleClass({ gradeCode: '3', today });
    const counts = [1, 2, 3, 4].map(
      (rank) => payload.students.filter((s) => s.levelRank === rank).length,
    );
    expect(counts).toEqual([3, 4, 10, 3]);
  });

  it.each(SAMPLE_GRADES)('gives the %se année a full week with no overlapping blocks', (grade) => {
    const { blocks } = buildSampleClass({ gradeCode: grade, today });
    expect(new Set(blocks.map((b) => b.dayKey))).toEqual(new Set([1, 2, 3, 4, 5]));
    for (let day = 1; day <= 5; day++) {
      const sorted = blocks
        .filter((b) => b.dayKey === day)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
      expect(sorted).toHaveLength(10);
      for (let i = 1; i < sorted.length; i++) {
        expect(timeToMinutes(sorted[i]!.start)).toBeGreaterThanOrEqual(
          timeToMinutes(sorted[i - 1]!.end),
        );
      }
      // Français and Mathématiques every day, so Aujourd'hui always has their lessons.
      const subjects = sorted.map((b) => b.subjectCode);
      expect(subjects).toContain('fra');
      expect(subjects).toContain('mat');
    }
    expect(blocks.every((b) => b.kind !== 'subject' || b.subjectCode !== null)).toBe(true);
  });

  it('fits a rotating-day school’s cycle and the database’s limit of 80 blocks', () => {
    const six = buildSampleClass({ gradeCode: '3', today, dayCount: 6 }).blocks;
    expect(Math.max(...six.map((b) => b.dayKey))).toBe(6);
    expect(six).toHaveLength(60);
    const two = buildSampleClass({ gradeCode: '3', today, dayCount: 2 }).blocks;
    expect(new Set(two.map((b) => b.dayKey))).toEqual(new Set([1, 2]));
    for (const dayCount of [9, 10, 20]) {
      const blocks = buildSampleClass({ gradeCode: '5', today, dayCount }).blocks;
      expect(blocks.length).toBeLessThanOrEqual(80);
      expect(Math.max(...blocks.map((b) => b.dayKey))).toBeLessThanOrEqual(dayCount);
      expect(blocks.every((b) => b.kind === 'subject')).toBe(true);
    }
  });

  it.each(SAMPLE_GRADES)(
    'has a Français and a Mathématiques unit of 8 lessons for the %se année',
    (grade) => {
      const { units } = buildSampleClass({ gradeCode: grade, today });
      expect(units.map((u) => u.subjectCode)).toEqual(['fra', 'mat']);
      for (const unit of units) {
        expect(unit.lessons).toHaveLength(8);
        // The substitute's notes are on lesson 4, the next lesson to teach.
        expect(unit.lessons.map((l) => l.subNotes !== null)).toEqual([
          false,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
        ]);
        expect(new Set(unit.lessons.map((l) => l.title)).size).toBe(8);
      }
      expect(sampleUnits(grade)).toHaveLength(2);
    },
  );

  it('marks lessons 1 to 3 taught on the 3 weekdays before today, oldest first', () => {
    const { units } = buildSampleClass({ gradeCode: '3', today });
    for (const unit of units) {
      expect(unit.taughtOn).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    }
    // A Monday: the previous Wednesday to Friday.
    expect(weekdaysBefore('2026-11-16', 3)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    for (const day of weekdaysBefore('2026-11-17', 10)) {
      expect(isoWeekday(day)).toBeLessThan(6);
    }
  });

  it.each(SAMPLE_GRADES)('writes the %se année in Canadian French', (grade) => {
    const payload = buildSampleClass({ gradeCode: grade, today });
    for (const text of proseStrings(payload)) {
      expect(frenchStyleProblems(text), text).toEqual([]);
    }
    // The text written in content-*.ts needs the typography fixes only.
    for (const unit of sampleUnits(grade)) {
      mapStrings(unit, (text) => {
        expect(
          frenchStyleProblems(text).filter(
            (p) => p.code !== 'colonSpacing' && p.code !== 'guillemetSpacing',
          ),
          text,
        ).toEqual([]);
        return text;
      });
    }
  });

  it('names no student in its own lessons', () => {
    for (const grade of SAMPLE_GRADES) {
      const text = fold(proseStrings(buildSampleClass({ gradeCode: grade, today })).join(' '));
      for (const name of SAMPLE_FIRST_NAMES) {
        expect(text, name).not.toMatch(new RegExp(`(^|[^\\p{L}])${fold(name)}([^\\p{L}]|$)`, 'u'));
      }
    }
  });
});
