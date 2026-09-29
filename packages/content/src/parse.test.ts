import { describe, expect, it } from 'vitest';
import { aiFaithContent, normalizeAiVersion } from './ai';
import { LIBRARY_ITEM_TYPES } from './catalog';
import { parseAnswerKey, parseVersionContent } from './parse';
import { sampleCanonical, sampleKey, sampleLevels, sampleVersion } from './samples';
import { contentSchema, type ContentOf } from './schemas';

describe('parse', () => {
  it('parses valid content and says whether it passes final', () => {
    const { content } = sampleCanonical('quiz');
    expect(parseVersionContent('quiz', content)).toEqual({ ok: true, content, valid: true });
    const draft = { ...content, questions: [] };
    expect(parseVersionContent('quiz', draft)).toEqual({ ok: true, content: draft, valid: false });
  });

  it('keeps what it can of content that fails the schema', () => {
    const { content } = sampleCanonical('quiz');
    const parsed = parseVersionContent('quiz', {
      ...content,
      instructions: 42,
      extra: 'caché',
      questions: [content.questions[0], { id: 'x', kind: 'essay', prompt: 'Rédige.' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.valid).toBe(false);
    expect(parsed.content.instructions).toBe('42');
    expect('extra' in parsed.content).toBe(false);
    expect(parsed.content.questions[0]).toEqual(content.questions[0]);
    expect(parsed.content.questions[1]).toMatchObject({
      id: 'x',
      kind: 'essay',
      prompt: 'Rédige.',
    });
  });

  it('refuses what is not content of the type', () => {
    expect(parseVersionContent('quiz', null)).toEqual({ ok: false });
    expect(parseVersionContent('quiz', ['x'])).toEqual({ ok: false });
    expect(parseVersionContent('quiz', { title: 'x', teacherNote: '' })).toEqual({ ok: false });
    expect(parseVersionContent('rubric', sampleCanonical('song').content)).toEqual({ ok: false });
  });

  it('parses answer keys leniently', () => {
    const { answerKey } = sampleCanonical('quiz');
    expect(parseAnswerKey(answerKey)).toEqual({ ok: true, key: answerKey, valid: true });
    const odd = parseAnswerKey({
      answers: [{ questionId: 'q', kind: 'essay' }, answerKey!.answers[0]],
    });
    expect(odd).toEqual({
      ok: true,
      key: { answers: [answerKey!.answers[0]], solution: '' },
      valid: false,
    });
    expect(parseAnswerKey('x')).toEqual({ ok: false });
  });
});

describe('samples', () => {
  it('have keys for keyed types, copies per level, and no faith words outside faith types', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const base = sampleVersion(type);
      const levels = sampleLevels(type, base, ['L1', 'L2']);
      expect(levels.map((l) => l.level)).toEqual(['L1', 'L2']);
      for (const level of levels) {
        const { content } = normalizeAiVersion(type, level);
        expect(contentSchema(type, 'final').safeParse(content).success, type).toBe(true);
      }
      const faith = aiFaithContent(
        type,
        [normalizeAiVersion(type, { content: base, answerKey: sampleKey(type, base) }).content],
        false,
      );
      expect(faith, type).toBe(type === 'catholic_reflection');
    }
  });

  it('infers canonical types', () => {
    // Compile-time checks: the inferred content types are the canonical shapes.
    const quiz: ContentOf<'quiz'> = sampleCanonical('quiz').content;
    const first = quiz.questions[0]!;
    if (first.kind === 'multiple_choice') expect(first.choices.length).toBeGreaterThan(1);
    const rubric: ContentOf<'rubric'> = sampleCanonical('rubric').content;
    expect(rubric.criteria[0]!.levels.level1).toContain('limitée');
    const experiment: ContentOf<'experiment'> = sampleCanonical('experiment').content;
    expect(experiment.observationTable?.rows).toBe(3);
  });
});
