import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeAiContent, normalizeAiKey } from './ai';
import { validateAnswerKey } from './answer-key';
import { emptyAuthoring, fromAuthoring } from './authoring';
import { LIBRARY_ITEM_TYPES } from './catalog';
import { safetyNotesSchema } from './safety';
import { sampleCanonical, sampleKey, sampleVersion } from './samples';
import { answerKeySchema, contentSchema, emptyContent, libraryItemFormSchema } from './schemas';
import { frenchStrings, frenchStyleProblems } from './style';

const paths = (result: { success: boolean; error?: z.ZodError }) =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('schemas', () => {
  it('3. every sample parses in ai, then (normalized) in draft and final', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const ai = sampleVersion(type, { title: 'Titre', objective: 'Objectif' });
      expect(contentSchema(type, 'ai').safeParse(ai).success, type).toBe(true);
      const rawKey = sampleKey(type, ai);
      if (rawKey) expect(answerKeySchema('ai').safeParse(rawKey).success, type).toBe(true);
      const key = normalizeAiKey(rawKey);
      const content = normalizeAiContent(type, ai, key);
      expect(paths(contentSchema(type, 'draft').safeParse(content)), type).toEqual([]);
      expect(paths(contentSchema(type, 'final').safeParse(content)), type).toEqual([]);
      if (key) expect(paths(answerKeySchema('final').safeParse(key)), type).toEqual([]);
      expect(validateAnswerKey(type, content, key), type).toEqual([]);
      const problems = frenchStrings(type, content).flatMap(frenchStyleProblems);
      expect(problems, type).toEqual([]);
    }
  });

  it('4. empty authoring gives draft-valid content that is not final', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const { content, key } = fromAuthoring(type, emptyAuthoring(type));
      expect(paths(contentSchema(type, 'draft').safeParse(content)), type).toEqual([]);
      expect(contentSchema(type, 'final').safeParse(content).success, type).toBe(false);
      if (key) expect(answerKeySchema('draft').safeParse(key).success, type).toBe(true);
      expect(emptyContent(type)).toEqual(content);
    }
  });

  it('5. refuses an extra key (an answer slipped into content) in draft and final', () => {
    const { content } = sampleCanonical('quiz');
    const questions = content.questions.map((q, i) => (i === 0 ? { ...q, correct: true } : q));
    for (const mode of ['draft', 'final'] as const) {
      const result = contentSchema('quiz', mode).safeParse({ ...content, questions });
      expect(result.success).toBe(false);
      expect(result.error!.issues[0]!.code).toBe('unrecognized_keys');
      expect(contentSchema('quiz', mode).safeParse({ ...content, answers: [] }).success).toBe(
        false,
      );
    }
  });

  it('6. refuses a 1,001-character prompt in draft', () => {
    const { content } = sampleCanonical('quiz');
    const questions = content.questions.map((q, i) =>
      i === 0 ? { ...q, prompt: 'x'.repeat(1001) } : q,
    );
    const result = contentSchema('quiz', 'draft').safeParse({ ...content, questions });
    expect(paths(result)).toEqual(['questions.0.prompt']);
    expect(result.error!.issues[0]!.message).toBe('tooLong');
    const ok = content.questions.map((q, i) => (i === 0 ? { ...q, prompt: 'x'.repeat(1000) } : q));
    expect(contentSchema('quiz', 'draft').safeParse({ ...content, questions: ok }).success).toBe(
      true,
    );
  });

  it('7. refuses in final a rubric missing a category, at criteria', () => {
    const { content } = sampleCanonical('rubric');
    const criteria = content.criteria.map((c) =>
      c.category === 'application' ? { ...c, category: 'communication' as const } : c,
    );
    const result = contentSchema('rubric', 'final').safeParse({ ...content, criteria });
    expect(paths(result)).toEqual(['criteria']);
    expect(result.error!.issues[0]!.message).toBe('missingCategory');
    expect(contentSchema('rubric', 'draft').safeParse({ ...content, criteria }).success).toBe(true);
  });

  it('8. needs both halves of a family guide', () => {
    const { content } = sampleCanonical('parent_guide');
    const { en: _en, ...frOnly } = content;
    expect(contentSchema('parent_guide', 'draft').safeParse(frOnly).success).toBe(false);
    expect(contentSchema('parent_guide', 'final').safeParse(frOnly).success).toBe(false);
    const emptyEn = { ...content, en: emptyContent('parent_guide').en };
    expect(contentSchema('parent_guide', 'draft').safeParse(emptyEn).success).toBe(true);
    expect(paths(contentSchema('parent_guide', 'final').safeParse(emptyEn))).toEqual([
      'en.intro',
      'en.learning',
      'en.atHome',
    ]);
  });

  it('9. refuses an exit ticket with 4 questions', () => {
    const { content } = sampleCanonical('exit_ticket');
    const q = content.questions[0]!;
    const questions = [q, { ...q, id: 'b' }, { ...q, id: 'c' }, { ...q, id: 'd' }];
    for (const mode of ['draft', 'final'] as const) {
      const result = contentSchema('exit_ticket', mode).safeParse({ ...content, questions });
      expect(paths(result)).toEqual(['questions']);
    }
  });

  it('10. accepts only short answers in riddles', () => {
    const { content } = sampleCanonical('riddle');
    const { content: quiz } = sampleCanonical('quiz');
    const riddles = [...content.riddles, quiz.questions[0]!];
    for (const mode of ['draft', 'final'] as const) {
      const result = contentSchema('riddle', mode).safeParse({ ...content, riddles });
      expect(result.success).toBe(false);
      expect(paths(result)[0]).toMatch(/^riddles\.2/);
    }
  });

  describe('11. safety notes (mirrors app.library_safety_notes_valid)', () => {
    const complete = {
      ageSuitability: 'Convient aux élèves de 8 à 11 ans.',
      allergyAwareMaterials: 'Élastiques sans latex.',
      supervision: 'standard',
      hazards: ['Un élastique peut claquer.'],
      notes: '',
    };
    const final = (notes: unknown) => safetyNotesSchema('final').safeParse(notes).success;

    it('accepts complete notes, every supervision level, and absent hazards and notes', () => {
      expect(final(complete)).toBe(true);
      for (const supervision of ['standard', 'close', 'adult_only']) {
        expect(final({ ...complete, supervision })).toBe(true);
      }
      const { hazards: _h, notes: _n, ...minimal } = complete;
      expect(safetyNotesSchema('final').parse(minimal)).toEqual({
        ...minimal,
        hazards: [],
        notes: '',
      });
    });

    it('refuses missing, blank or too long required fields', () => {
      expect(final(null)).toBe(false);
      expect(final('standard')).toBe(false);
      const { ageSuitability: _a, ...noAge } = complete;
      expect(final(noAge)).toBe(false);
      expect(final({ ...complete, ageSuitability: '   ' })).toBe(false);
      expect(final({ ...complete, ageSuitability: 'a'.repeat(300) })).toBe(true);
      expect(final({ ...complete, ageSuitability: 'a'.repeat(301) })).toBe(false);
      const { allergyAwareMaterials: _m, ...noAllergy } = complete;
      expect(final(noAllergy)).toBe(false);
      expect(final({ ...complete, allergyAwareMaterials: '' })).toBe(false);
      expect(final({ ...complete, allergyAwareMaterials: 'a'.repeat(600) })).toBe(true);
      expect(final({ ...complete, allergyAwareMaterials: 'a'.repeat(601) })).toBe(false);
    });

    it('refuses an unknown supervision, hazards that are not a list, and unknown keys', () => {
      const { supervision: _s, ...noSupervision } = complete;
      expect(final(noSupervision)).toBe(false);
      expect(final({ ...complete, supervision: 'loose' })).toBe(false);
      expect(final({ ...complete, hazards: 'ciseaux' })).toBe(false);
      expect(final({ ...complete, extra: true })).toBe(false);
    });

    it('lets drafts stay empty', () => {
      const empty = {
        ageSuitability: '',
        allergyAwareMaterials: '',
        supervision: '',
        hazards: [],
        notes: '',
      };
      expect(safetyNotesSchema('draft').safeParse(empty).success).toBe(true);
      expect(final(empty)).toBe(false);
    });
  });

  it('12. accepts a worksheet without questions when it has instructions or text', () => {
    const base = { ...emptyContent('worksheet') };
    const final = contentSchema('worksheet', 'final');
    expect(final.safeParse({ ...base, instructions: 'Colorie les multiples de 5.' }).success).toBe(
      true,
    );
    expect(final.safeParse({ ...base, text: 'Un court texte.' }).success).toBe(true);
    const empty = final.safeParse({ ...base, instructions: '  ' });
    expect(paths(empty)).toEqual(['instructions']);
    expect(empty.error!.issues[0]!.message).toBe('worksheetEmpty');
  });

  it('13. ai schemas carry no constraint that structured outputs would drop', () => {
    const forbidden = [
      'enum',
      'const',
      'pattern',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
    ];
    const keysOf = (value: unknown, found = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          found.add(k);
          keysOf(v, found);
        }
      }
      return found;
    };
    const schemas = [
      answerKeySchema('ai'),
      safetyNotesSchema('ai'),
      ...LIBRARY_ITEM_TYPES.map((t) => contentSchema(t, 'ai')),
    ];
    for (const schema of schemas) {
      const keys = keysOf(z.toJSONSchema(schema));
      expect(forbidden.filter((k) => keys.has(k))).toEqual([]);
    }
  });

  it('checks the save form per type, with full paths and error keys', () => {
    const { content, answerKey } = sampleCanonical('quiz');
    const form = {
      type: 'quiz',
      boardId: '00000000-0000-4000-8000-000000000001',
      schoolId: null,
      title: ' Quiz ',
      summary: '',
      licence: '',
      subjectId: null,
      gradeCodes: ['3'],
      expectationIds: [],
      tagIds: [],
      keywords: 'nombres',
      durationMinutes: 20,
      materials: 'Crayon',
      isPrintable: true,
      isProjectable: false,
      isInteractive: false,
      subFriendly: true,
      safetyNotes: null,
      faithContent: false,
      faithOnStudentSheet: false,
      catholicConnection: '',
      catholicReferenceId: null,
      versions: [{ languageLevelId: null, content, answerKey }],
    };
    const ok = libraryItemFormSchema.safeParse(form);
    expect(ok.success).toBe(true);
    expect(ok.data!.title).toBe('Quiz');

    const bad = libraryItemFormSchema.safeParse({
      ...form,
      type: 'unit_test',
      versions: [
        { languageLevelId: null, content: { ...content, extra: 1 }, answerKey },
        { languageLevelId: null, content, answerKey: null },
      ],
    });
    const issues = bad.error!.issues.map((i) => [i.path.join('.'), i.message]);
    expect(issues).toContainEqual(['versions', 'baseVersion']);
    expect(issues).toContainEqual(['versions.1.languageLevelId', 'duplicateLevel']);
    expect(issues).toContainEqual(['subFriendly', 'subFriendlyNotAllowed']);
    expect(issues.some(([path]) => path!.startsWith('versions.0.content'))).toBe(true);
  });
});
