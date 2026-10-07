import { describe, expect, it } from 'vitest';
import type { ReportBankFormContext, ReportBankFormValues } from '@/server/queries/report-bank-ai';
import {
  bankSubjects,
  bankValuesFromParams,
  defaultBankValues,
  effectiveBankValues,
  reportBankDraftPrefix,
  toBankForm,
} from './report-bank-values';

const BOARD = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BOARD = 'b0000000-0000-4000-8000-000000000002';
const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const MAT = 'ece67150-44d3-4e6e-b772-d9bde2165caf';
const HIG = 'a557cdda-4d76-4191-b1d6-6d07dd79c5fa';
const ERE = '5c0c4af1-29ca-480f-83d6-7f47e7ab5ebd';
const OWN = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const EXP = (n: number) => `20000000-0000-4000-8000-0000000300${String(n).padStart(2, '0')}`;

const context: ReportBankFormContext = {
  userId: 'd0000000-0000-4000-8000-000000000001',
  schools: [{ id: SCHOOL, boardId: BOARD, name: 'École', aiEnabled: true, boardOff: false }],
  grades: [
    { code: '3', label: '3e année', ordinal: 3 },
    { code: '7', label: '7e année', ordinal: 7 },
  ],
  subjects: [
    { id: MAT, code: 'mat', label: 'Mathématiques', gradeMin: 1, gradeMax: 8, boardId: null },
    {
      id: HIG,
      code: 'hig',
      label: 'Histoire et géographie',
      gradeMin: 7,
      gradeMax: 8,
      boardId: null,
    },
    {
      id: ERE,
      code: 'ere',
      label: 'Enseignement religieux',
      gradeMin: -1,
      gradeMax: 8,
      boardId: null,
    },
    { id: OWN, code: 'autre', label: 'Autre', gradeMin: 1, gradeMax: 8, boardId: OTHER_BOARD },
  ],
  defaultGrade: '3',
};

const values = (changes: Partial<ReportBankFormValues> = {}): ReportBankFormValues => ({
  ...defaultBankValues(context),
  ...changes,
});

describe('« Créer une banque avec l’IA »: the form’s rules', () => {
  it('keeps drafts per user', () => {
    expect(reportBankDraftPrefix('u1')).toBe('report-bank-generate:u1');
  });

  it('starts from her first grade, a subject’s report card bank of medium entries', () => {
    expect(defaultBankValues(context)).toEqual({
      schoolId: SCHOOL,
      scope: 'subject',
      period: 'term',
      gradeCode: '3',
      subjectId: '',
      expectationIds: [],
      length: 'medium',
      teacherNote: '',
    });
  });

  it('offers the subjects of the grade, never ERE for a subject, only ERE for religion', () => {
    const labels = (v: ReportBankFormValues) => bankSubjects(context, v).map((s) => s.code);
    expect(labels(values())).toEqual(['mat']);
    expect(labels(values({ gradeCode: '7' }))).toEqual(['mat', 'hig']);
    expect(labels(values({ scope: 'religion' }))).toEqual(['ere']);
    expect(labels(values({ scope: 'learning_skills' }))).toEqual([]);
    expect(labels(values({ gradeCode: '' }))).toEqual([]);
  });

  it('keeps only what still applies', () => {
    expect(effectiveBankValues(values({ scope: 'religion' }), context).subjectId).toBe(ERE);
    expect(effectiveBankValues(values({ subjectId: ERE }), context).subjectId).toBe('');
    expect(effectiveBankValues(values({ subjectId: HIG }), context).subjectId).toBe('');
    expect(effectiveBankValues(values({ gradeCode: '5' }), context).gradeCode).toBe('');
    const many = Array.from({ length: 14 }, (_, i) => EXP(i + 1));
    const kept = effectiveBankValues(
      values({ subjectId: MAT, expectationIds: [...many, EXP(1), 'not-an-id'] }),
      context,
    );
    expect(kept.expectationIds).toEqual(many.slice(0, 12));
    // No subject: no attentes; the learning skills have neither.
    expect(
      effectiveBankValues(values({ expectationIds: [EXP(1)] }), context).expectationIds,
    ).toEqual([]);
    expect(
      effectiveBankValues(
        values({ scope: 'learning_skills', subjectId: MAT, expectationIds: [EXP(1)] }),
        context,
      ),
    ).toMatchObject({ subjectId: '', expectationIds: [] });
    expect(
      effectiveBankValues(
        values({
          period: 'any' as never,
          length: 'long' as never,
          teacherNote: 'x'.repeat(600),
        }),
        context,
      ),
    ).toMatchObject({ period: 'term', length: 'medium', teacherNote: 'x'.repeat(500) });
  });

  it('reads a link of « Bulletins »: ids and choices only', () => {
    expect(bankValuesFromParams(context, {})).toBeNull();
    expect(
      bankValuesFromParams(context, {
        scope: 'subject',
        grade: '3',
        subject: MAT,
        period: 'progress',
        exp: `${EXP(1)},${EXP(2)}`,
      }),
    ).toEqual({
      ...defaultBankValues(context),
      period: 'progress',
      subjectId: MAT,
      expectationIds: [EXP(1), EXP(2)],
    });
    expect(bankValuesFromParams(context, { scope: 'learning_skills', grade: '7' })).toMatchObject({
      scope: 'learning_skills',
      gradeCode: '7',
      subjectId: '',
    });
    expect(bankValuesFromParams(context, { scope: 'nothing', period: 'any' })).toMatchObject({
      scope: 'subject',
      period: 'term',
    });
  });

  it('sends ids and choices only, no subject or attente for the learning skills', () => {
    expect(toBankForm(values({ subjectId: MAT, expectationIds: [EXP(1)] }))).toEqual({
      schoolId: SCHOOL,
      scope: 'subject',
      period: 'term',
      gradeCode: '3',
      subjectId: MAT,
      expectationIds: [EXP(1)],
      length: 'medium',
      teacherNote: '',
    });
    expect(
      toBankForm(values({ scope: 'learning_skills', subjectId: MAT, expectationIds: [EXP(1)] })),
    ).toMatchObject({ subjectId: null, expectationIds: [] });
    expect(toBankForm(values({ subjectId: '' })).subjectId).toBeNull();
  });
});
