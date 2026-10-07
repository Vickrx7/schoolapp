import { describe, expect, it } from 'vitest';
import type { DifferentiateInput } from '@lynx/ai/features/differentiate';
import {
  defaultFormValues,
  effectiveFormValues,
  resumeFormValues,
  subjectFitsGrade,
  subjectsForGrade,
} from './form-values';

const SCHOOL = '00000000-0000-4000-8000-00000000000a';
const OTHER_SCHOOL = '00000000-0000-4000-8000-00000000000b';
const BOARD = 'board-1';
const level = (id: string, personal = false, boardId = BOARD) => ({
  id,
  boardId,
  label: id,
  description: null,
  personal,
  active: true,
});

const context = {
  schools: [
    { id: SCHOOL, boardId: BOARD, name: 'Saint-Exemple', aiEnabled: true, boardAllows: true },
  ],
  levels: [level('deb'), level('int'), level('mine', true), level('far', false, 'board-2')],
  grades: [
    { code: '3', label: '3e année', ordinal: 3 },
    { code: '7', label: '7e année', ordinal: 7 },
  ],
  subjects: [
    { id: 'fra', label: 'Français', gradeMin: 1, gradeMax: 8 },
    { id: 'hig', label: 'Histoire et géographie', gradeMin: 7, gradeMax: 8 },
  ],
  defaultGrade: null,
};

describe('new-request form values', () => {
  it('starts with the board’s levels of the school', () => {
    expect(defaultFormValues(context)).toMatchObject({
      schoolId: SCHOOL,
      gradeCode: '3',
      subjectId: '',
      levelIds: ['deb', 'int'],
    });
  });

  it('never uses a school from a draft left by another account', () => {
    const restored = { ...defaultFormValues(context), schoolId: OTHER_SCHOOL, levelIds: ['far'] };
    const v = effectiveFormValues(restored, context);
    expect(v.schoolId).toBe(SCHOOL);
    expect(v.levelIds).toEqual([]);
  });

  it('drops a subject that is not taught in the chosen grade', () => {
    expect(subjectsForGrade(context.subjects, context.grades[0]).map((s) => s.id)).toEqual(['fra']);
    expect(subjectFitsGrade(context, 'hig', '7')).toBe(true);
    expect(subjectFitsGrade(context, 'hig', '3')).toBe(false);
    const v = effectiveFormValues(
      { ...defaultFormValues(context), gradeCode: '3', subjectId: 'hig' },
      context,
    );
    expect(v.subjectId).toBe('');
  });

  it('fills the form from a request that failed, to send it again', () => {
    const input: DifferentiateInput = {
      title: 'Le castor',
      text: 'Le castor construit un barrage avec des branches.',
      objective: 'Trouver l’idée principale',
      itemType: 'worksheet',
      gradeCode: '7',
      gradeLabel: '7e année',
      subjectId: 'hig',
      subjectLabel: 'Histoire et géographie',
      levels: [
        { key: 'L1', languageLevelId: 'deb', label: 'Débutant', description: null },
        { key: 'L2', languageLevelId: 'mine', label: 'Accueil', description: null },
        { key: 'L3', languageLevelId: 'deleted', label: 'Ancien', description: null },
      ],
    };
    expect(resumeFormValues(context, { schoolId: SCHOOL, input })).toEqual({
      schoolId: SCHOOL,
      title: 'Le castor',
      text: 'Le castor construit un barrage avec des branches.',
      objective: 'Trouver l’idée principale',
      itemType: 'worksheet',
      gradeCode: '7',
      subjectId: 'hig',
      levelIds: ['deb', 'mine'],
    });
  });
});
