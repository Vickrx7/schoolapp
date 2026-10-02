import { describe, expect, it } from 'vitest';
import type { GenerateFormContext, GenerateFormValues } from '@/server/queries/library-ai';
import {
  chosenReferenceId,
  effectiveGenerateValues,
  referenceChoices,
  subjectsForGrades,
  toGenerateForm,
} from './generate-values';

const BOARD = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BOARD = 'b0000000-0000-4000-8000-000000000002';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const MAT = 'ece67150-44d3-4e6e-b772-d9bde2165caf';
const SCI = '5c0a9e3e-8f59-4d5b-9d0a-3b0d9a6f1c21';
const ANG = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';

const ref = (
  id: string,
  title: string,
  overrides: Partial<GenerateFormContext['references'][number]> = {},
) => ({
  id,
  boardId: BOARD,
  type: 'virtue' as const,
  title,
  textFr: 'Texte',
  gradeMin: -1,
  gradeMax: 8,
  liturgicalSeason: null,
  tags: [],
  ...overrides,
});

const context: GenerateFormContext = {
  userId: 'd0000000-0000-4000-8000-000000000001',
  schools: [
    {
      id: SCHOOL,
      boardId: BOARD,
      name: 'École',
      aiEnabled: true,
      boardOff: false,
      today: '2026-10-19',
    },
  ],
  grades: [
    { code: '2', label: '2e année', ordinal: 2 },
    { code: '3', label: '3e année', ordinal: 3 },
    { code: '5', label: '5e année', ordinal: 5 },
  ],
  subjects: [
    { id: MAT, code: 'mat', label: 'Mathématiques', gradeMin: 1, gradeMax: 8, boardId: null },
    {
      id: SCI,
      code: 'sci',
      label: 'Sciences et technologie',
      gradeMin: 1,
      gradeMax: 8,
      boardId: null,
    },
    { id: ANG, code: 'ang', label: 'Anglais', gradeMin: 1, gradeMax: 8, boardId: null },
  ],
  anglaisStartGrade: 4,
  levels: [
    {
      id: 'l1',
      boardId: BOARD,
      label: 'Débutant',
      description: null,
      personal: false,
      active: true,
    },
    {
      id: 'l2',
      boardId: BOARD,
      label: 'Enrichi',
      description: null,
      personal: false,
      active: true,
    },
    {
      id: 'lx',
      boardId: OTHER_BOARD,
      label: 'Autre',
      description: null,
      personal: false,
      active: true,
    },
  ],
  references: [
    ref('r1', 'Le respect', { tags: ['respect'] }),
    ref('r2', 'Prendre soin de la création', {
      type: 'reflection',
      tags: ['sciences', 'création'],
    }),
    ref('r3', 'Prière de l’Avent', { type: 'prayer', liturgicalSeason: 'avent' }),
    ref('r4', 'Réservée au 7e', { gradeMin: 7 }),
    ref('rb', 'Autre conseil', { boardId: OTHER_BOARD }),
  ],
  defaultGrade: '3',
};

const values: GenerateFormValues = {
  schoolId: SCHOOL,
  itemType: 'worksheet',
  gradeCodes: ['3'],
  subjectId: MAT,
  expectationIds: ['e1'],
  withLevels: true,
  levelIds: ['l1', 'l2'],
  faith: false,
  catholicReferenceId: '',
  referenceChosen: false,
  durationMinutes: 30,
  subFriendly: true,
  teacherNote: '',
};

describe('the « Créer avec l’IA » form', () => {
  it('offers the subjects of every chosen grade, Anglais from the board’s start grade', () => {
    expect(subjectsForGrades(context, ['3']).map((s) => s.code)).toEqual(['mat', 'sci']);
    expect(subjectsForGrades(context, ['5']).map((s) => s.code)).toEqual(['mat', 'sci', 'ang']);
    expect(subjectsForGrades(context, ['3', '5']).map((s) => s.code)).toEqual(['mat', 'sci']);
    expect(subjectsForGrades(context, [])).toEqual([]);
  });

  it('keeps only what a restored draft may still hold', () => {
    const restored = effectiveGenerateValues(
      {
        ...values,
        schoolId: 'gone',
        gradeCodes: ['3', '5', '2'],
        levelIds: ['l1', 'lx', 'gone'],
        catholicReferenceId: 'rb',
        referenceChosen: true,
        durationMinutes: 33,
      },
      context,
    );
    expect(restored).toMatchObject({
      schoolId: SCHOOL,
      gradeCodes: ['3', '5'],
      levelIds: ['l1'],
      catholicReferenceId: '',
      referenceChosen: false,
      durationMinutes: 30,
    });
    // A subject not taught in the grades clears it and its attentes.
    expect(
      effectiveGenerateValues({ ...values, gradeCodes: ['2'], subjectId: ANG }, context),
    ).toMatchObject({ subjectId: '', expectationIds: [] });
    // What the type does not have: levels, a substitute, and the faith link forced on.
    expect(effectiveGenerateValues({ ...values, itemType: 'rubric' }, context)).toMatchObject({
      withLevels: false,
      subFriendly: false,
    });
    expect(
      effectiveGenerateValues({ ...values, itemType: 'catholic_reflection' }, context).faith,
    ).toBe(true);
    // A comment bank has its own form (D-132): an old draft falls back to a worksheet.
    expect(
      effectiveGenerateValues({ ...values, itemType: 'report_comments' }, context).itemType,
    ).toBe('worksheet');
  });

  it('suggests the references that fit, best first, then the others (D-074)', () => {
    const choices = referenceChoices(
      context,
      { ...values, subjectId: SCI },
      {
        subject: 'Sciences et technologie',
        expectations: ['Les forces qui agissent sur les structures.'],
      },
    );
    const titles = choices.references.map((r) => r.title);
    expect(titles[0]).toBe('Prendre soin de la création');
    expect(choices.suggested).toBe(2);
    // Out of season or of grade come after, never another board's.
    expect(titles.slice(2)).toEqual(['Prière de l’Avent', 'Réservée au 7e']);
    expect(titles).not.toContain('Autre conseil');

    expect(chosenReferenceId(values, choices)).toBe('r2');
    expect(
      chosenReferenceId({ ...values, catholicReferenceId: 'r1', referenceChosen: true }, choices),
    ).toBe('r1');
    expect(chosenReferenceId(values, { references: [], suggested: 0 })).toBe('');
  });

  it('sends ids and choices only, with levels and the faith link only when asked for', () => {
    expect(toGenerateForm(values, 'r2')).toEqual({
      schoolId: SCHOOL,
      itemType: 'worksheet',
      gradeCodes: ['3'],
      subjectId: MAT,
      expectationIds: ['e1'],
      levelIds: ['l1', 'l2'],
      catholicReferenceId: null,
      durationMinutes: 30,
      subFriendly: true,
      teacherNote: '',
    });
    expect(toGenerateForm({ ...values, withLevels: false, faith: true }, 'r2')).toMatchObject({
      levelIds: [],
      catholicReferenceId: 'r2',
    });
    expect(toGenerateForm({ ...values, itemType: 'unit_test' }, '')).toMatchObject({
      subFriendly: false,
    });
  });
});
