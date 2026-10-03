import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  LIBRARY_ITEM_TYPES,
  sampleCanonical,
  TYPE_INFO,
  type LibraryItemType,
} from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { Redactor, type KnownPerson } from '../privacy';
import { loadPrompt } from '../prompts';
import {
  libraryLevelsFeature as feature,
  libraryLevelsInputSchema,
  type LibraryLevelsAiOutput,
  type LibraryLevelsInput,
} from './library-levels';

const NOW = new Date('2026-09-28T12:00:00Z');
const LEVELS_TYPES = LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t].levelable);

function request(type: LibraryItemType, levelCount = 2): LibraryLevelsInput {
  const { content, answerKey } = sampleCanonical(type, {
    objective: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
  });
  return libraryLevelsInputSchema.parse({
    itemId: 'a1000000-0000-4000-8000-000000000001',
    baseRevision: 4,
    itemType: type,
    gradeLabels: ['3e année'],
    subjectLabel: 'Mathématiques',
    levels: ['Débutant', 'Enrichi', 'Avancé', 'Intermédiaire', 'Très avancé', 'Autre']
      .slice(0, levelCount)
      .map((label, i) => ({
        key: `L${i + 1}`,
        languageLevelId: `b100000${i}-0000-4000-8000-000000000001`,
        label,
        description: null,
        mostAccessible: i === 0,
      })),
    base: { content, answerKey },
  });
}

function answer(input: LibraryLevelsInput) {
  const raw = feature.outputSchemaFor!(input).parse(feature.fake(input));
  return feature.normalize!(raw, input);
}

describe('library_levels', () => {
  it('gives every type with levels an output schema the API accepts; the fake answer passes', () => {
    for (const type of LEVELS_TYPES) {
      const input = request(type, 4);
      expect(() => zodOutputFormat(feature.outputSchemaFor!(input)), type).not.toThrow();
      expect(feature.validate(answer(input), input), type).toEqual([]);
    }
  });

  it('refuses types without levels and a base that is not a draft of its type', () => {
    const quiz = request('quiz');
    expect(libraryLevelsInputSchema.safeParse({ ...quiz, itemType: 'rubric' }).success).toBe(false);
    expect(
      libraryLevelsInputSchema.safeParse({
        ...quiz,
        base: { content: { ...quiz.base.content, correct: 'c1' }, answerKey: null },
      }).success,
    ).toBe(false);
    expect(libraryLevelsInputSchema.safeParse({ ...quiz, levels: [] }).success).toBe(false);
  });

  it('ai 8. keeps the objective and, for assessments, the same questions of the same kinds', () => {
    const input = request('quiz', 2);
    const output = answer(input);
    const problems = (o: LibraryLevelsAiOutput) => feature.validate(o, input);
    expect(problems(output)).toEqual([]);

    const objective = structuredClone(output);
    objective.levels[0]!.content.objective = 'Additionner des nombres.';
    expect(problems(objective)).toContain('levels.0.content.objective: changed');
    // An empty objective means the base's.
    const empty = structuredClone(output);
    empty.levels[0]!.content.objective = '';
    expect(problems(empty)).toEqual([]);

    const fewer = structuredClone(output);
    const questions = fewer.levels[1]!.content.questions as Record<string, unknown>[];
    fewer.levels[1]!.content.questions = questions.slice(0, -1);
    fewer.levels[1]!.answerKey!.answers = (
      fewer.levels[1]!.answerKey!.answers as Record<string, unknown>[]
    ).slice(0, -1);
    expect(problems(fewer)).toContain('levels.1: 4 questions instead of 5');

    const kinds = structuredClone(output);
    const list = kinds.levels[0]!.content.questions as Record<string, unknown>[];
    kinds.levels[0]!.content.questions = [list[1], list[0], ...list.slice(2)];
    expect(problems(kinds)).toContain('levels.0: question kinds differ from the base version');

    // Other types keep their objective, but may change their questions.
    const game = request('game');
    const gameOutput = answer(game);
    gameOutput.levels[0]!.content.questions = [];
    gameOutput.levels[0]!.answerKey = null;
    expect(feature.validate(gameOutput, game)).toEqual([]);

    expect(problems({ levels: output.levels.slice(0, 1) })).toContain('missing level L2');
    const labelled = structuredClone(output);
    labelled.levels[0]!.content.instructions = 'Version Débutant : réponds.';
    expect(problems(labelled)).toContain('levels.0: level name shown to students');
  });

  it('de-identifies every string of the base, keeps ids, and allows only the markers it had', () => {
    const input = request('reading_passage');
    input.base.content.text = 'Jules et Aïcha observent un castor. Appelez au 613-555-0142.';
    const people: KnownPerson[] = [
      { name: 'Jules', kind: 'student' },
      { name: 'Aïcha', kind: 'student' },
    ];
    const blocked = feature.redactInput(input, new Redactor(people, NOW));
    expect(blocked.blocked.map((b) => b.kind)).toEqual(['phone']);

    input.base.content.text = 'Jules et Aïcha observent un castor.';
    const { input: sent } = feature.redactInput(input, new Redactor(people, NOW));
    expect(sent.base.content.text).toBe('Élève A et Élève B observent un castor.');
    const questions = sent.base.content.questions as { id: string; kind: string }[];
    expect(questions.map((q) => q.id)).toEqual(['sa2', 'tf2']);
    expect(questions.map((q) => q.kind)).toEqual(['short_answer', 'true_false']);
    expect(sent.characterNames).not.toContain('Jules');

    const message = feature.buildUserMessage(sent);
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(message).not.toMatch(/Jules|Aïcha/);
    expect(message).toContain('- L1 — Débutant (niveau le plus accessible)');
    expect(message).toContain('<version_de_base>');
    expect(message).toContain('<corrige_de_base>');

    // The answer may repeat the base's markers (names come back as written), never add one.
    const output = answer(sent);
    expect(feature.validate(output, sent)).toEqual([]);
    output.levels[1]!.content.text = 'Élève C regarde le castor.';
    expect(feature.validate(output, sent)).toContain('levels.1: a person marker');
  });

  it('sends the common part of its prompt and the section of the type only', async () => {
    const prompt = await loadPrompt('library_levels', 'v1');
    const sections = [...prompt.matchAll(/<!-- section: (type:[a-z_]+) -->/g)].map((m) => m[1]);
    expect(new Set(sections)).toEqual(new Set(LEVELS_TYPES.map((t) => `type:${t}`)));
    const system = feature.systemPrompt!(prompt, request('quiz'));
    expect(system).toContain('## Règles essentielles');
    expect(system).toContain('## Type : Quiz');
    expect(system.match(/## Type : /g)).toHaveLength(1);
  });
});
