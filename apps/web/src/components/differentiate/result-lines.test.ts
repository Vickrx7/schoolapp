import { describe, expect, it } from 'vitest';
import {
  resolveFieldErrors,
  toEditable,
  versionPayload,
  type EditableVersion,
} from './result-lines';

const version = (over: Partial<EditableVersion> = {}): EditableVersion => ({
  languageLevelId: '00000000-0000-4000-8000-000000000001',
  levelLabel: 'Débutant',
  title: 'Le castor',
  text: 'Le castor construit un barrage.',
  glossary: '',
  visualSupports: '',
  questions: '',
  teacherNote: '',
  ...over,
});

describe('result editor lines', () => {
  it('sends one item per non-empty line and remembers each line number', () => {
    const { payload, lines } = versionPayload(
      version({
        glossary: 'castor : animal\n\n  barrage : mur de branches  \n',
        questions: '\nOù vit le castor ?\n\nPourquoi ?',
      }),
    );
    expect(payload.glossary).toEqual([
      { term: 'castor', definition: 'animal' },
      { term: 'barrage', definition: 'mur de branches' },
    ]);
    expect(lines.glossary).toEqual([1, 3]);
    expect(payload.questions).toEqual(['Où vit le castor ?', 'Pourquoi ?']);
    expect(lines.questions).toEqual([2, 4]);
  });

  it('sends a glossary line without a word, so the teacher is told instead of losing it', () => {
    const { payload } = versionPayload(version({ glossary: ': une définition sans mot' }));
    expect(payload.glossary).toEqual([{ term: '', definition: 'une définition sans mot' }]);
  });

  it('turns stored versions back into editable text', () => {
    expect(
      toEditable({
        ...version(),
        glossary: [
          { term: 'castor', definition: 'animal' },
          { term: 'hutte', definition: '' },
        ],
        visualSupports: ['Une image'],
        questions: ['Q1', 'Q2'],
      }),
    ).toMatchObject({
      glossary: 'castor : animal\nhutte',
      visualSupports: 'Une image',
      questions: 'Q1\nQ2',
    });
  });
});

describe('save errors', () => {
  // What the save action returns for a dash instead of « : » on the 3rd line (the whole line
  // becomes a word over 80 characters) and a 501-character question on the 2nd level.
  const fieldErrors = {
    'versions.1.glossary.1.term': 'tooLong',
    'versions.2.questions.0': 'tooLong',
    title: 'required',
    versions: 'tooMany',
  };
  const lines = [
    { glossary: [1], visualSupports: [], questions: [1] },
    { glossary: [1, 3], visualSupports: [], questions: [] },
    { glossary: [], visualSupports: [], questions: [4] },
  ];

  it('shows each error on its field with the line it comes from', () => {
    const resolved = resolveFieldErrors(fieldErrors, lines);
    expect(resolved.fields).toEqual({
      'versions.1.glossary': { error: 'tooLong', line: 3 },
      'versions.2.questions': { error: 'tooLong', line: 4 },
      title: { error: 'required' },
    });
  });

  it('points phones at the first level with an error and keeps the rest for a message', () => {
    const resolved = resolveFieldErrors(fieldErrors, lines);
    expect(resolved.firstVersion).toBe(1);
    expect(resolved.unmatched).toEqual(['tooMany']);
  });

  it('still shows a list-level error (too many items) on the field', () => {
    const resolved = resolveFieldErrors({ 'versions.0.questions': 'tooMany' }, lines);
    expect(resolved.fields['versions.0.questions']).toEqual({ error: 'tooMany' });
  });
});
