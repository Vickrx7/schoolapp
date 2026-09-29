import { describe, expect, it } from 'vitest';
import { validateAnswerKey } from './answer-key';
import { fromDifferentiation } from './differentiation';
import { reviewReadiness } from './readiness';
import { answerKeySchema, contentSchema } from './schemas';

const LEVEL_A = '10000000-0000-4000-8000-00000000000a';
const LEVEL_B = '10000000-0000-4000-8000-00000000000b';

const result = (text: string) => ({
  title: 'Le castor',
  objective: 'Dégager l’idée principale.',
  versions: [
    {
      languageLevelId: LEVEL_A,
      title: 'Le castor',
      text,
      glossary: [{ term: 'barrage', definition: '' }],
      visualSupports: ['Photo d’un barrage.'],
      questions: ['De quoi parle le texte?', 'Où vit le castor?'],
      teacherNote: 'Lire à voix haute.',
    },
    {
      languageLevelId: LEVEL_B,
      title: 'Le castor bâtisseur',
      text,
      glossary: [],
      visualSupports: [],
      questions: [],
      teacherNote: '',
    },
  ],
});

describe('differentiation', () => {
  it('44. builds a canonical base and levels, with short answers and empty-sample keys', () => {
    for (const itemType of ['reading_passage', 'worksheet'] as const) {
      const long = 'a'.repeat(40_000);
      const { versions } = fromDifferentiation(
        { title: 'Le castor', text: 'Le castor vit près des rivières.', itemType },
        result(long),
      );
      expect(versions.map((v) => v.languageLevelId)).toEqual([null, LEVEL_A, LEVEL_B]);
      const [base, a, b] = versions;
      expect(base!.content).toMatchObject({
        title: 'Le castor',
        objective: 'Dégager l’idée principale.',
        text: 'Le castor vit près des rivières.',
        questions: [],
      });
      expect(base!.answerKey).toBeNull();
      for (const v of versions) {
        expect(contentSchema(itemType, 'draft').safeParse(v.content).success, itemType).toBe(true);
        expect(contentSchema(itemType, 'final').safeParse(v.content).success, itemType).toBe(true);
        expect(v.content.objective).toBe('Dégager l’idée principale.');
      }
      expect(a!.content.questions).toEqual([
        {
          id: 'q1',
          kind: 'short_answer',
          prompt: 'De quoi parle le texte?',
          hint: '',
          points: null,
          category: null,
          lines: 3,
        },
        {
          id: 'q2',
          kind: 'short_answer',
          prompt: 'Où vit le castor?',
          hint: '',
          points: null,
          category: null,
          lines: 3,
        },
      ]);
      expect(a!.answerKey!.answers.map((e) => [e.questionId, e.kind])).toEqual([
        ['q1', 'short_answer'],
        ['q2', 'short_answer'],
      ]);
      expect(answerKeySchema('final').safeParse(a!.answerKey).success).toBe(true);
      expect(validateAnswerKey(itemType, a!.content, a!.answerKey)).toEqual([]);
      expect(b!.answerKey).toBeNull();
      expect(a!.content.text).toHaveLength(40_000);
      expect(a!.content.glossary).toEqual([{ term: 'barrage', definition: '' }]);
    }
  });

  it('gives drafts that are ready except for the missing sample answers', () => {
    const { versions } = fromDifferentiation(
      { title: 'Le castor', text: 'Le castor vit près des rivières.', itemType: 'reading_passage' },
      result('Le castor construit des barrages.'),
    );
    const readiness = reviewReadiness({
      item: {
        type: 'reading_passage',
        gradeCodes: ['3'],
        subjectId: 's',
        durationMinutes: 30,
        materials: 'Texte',
        keywords: 'castor',
        tagIds: [],
        expectationIds: ['e'],
        safetyNotes: null,
        subFriendly: false,
      },
      versions,
      boardLevelIds: [],
      forApproval: false,
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.warnings.map((w) => w.code)).toEqual(['sampleAnswer', 'sampleAnswer']);
  });
});
