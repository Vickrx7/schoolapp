import { describe, expect, it } from 'vitest';
import type { DifferentiateOutput } from '../features/differentiate';
import { averageSentenceLength, checkDifferentiation } from './checks';
import { differentiateCases } from './differentiate-cases';

const good: DifferentiateOutput = {
  objective: 'Comprendre comment le castor construit son barrage.',
  versions: [
    {
      level: 'L1',
      title: 'Le castor',
      text: 'Le castor coupe des arbres. Il fait un barrage. Léa regarde le castor.',
      glossary: [
        { term: 'castor', definition: 'un animal' },
        { term: 'barrage', definition: 'un mur de branches' },
      ],
      visualSupports: [],
      questions: ['Que fait le castor ?'],
      teacherNote: 'Phrases courtes.',
    },
    {
      level: 'L2',
      title: 'Le castor, ingénieur',
      text: 'Avec ses dents solides, le castor coupe des arbres près de la rivière pour construire un barrage qui retient l’eau.',
      glossary: [],
      visualSupports: [],
      questions: ['Pourquoi le barrage est-il utile aux autres animaux de l’étang ?'],
      teacherNote: 'Vocabulaire plus riche.',
    },
  ],
};

describe('evaluation checks', () => {
  it('measures sentence length', () => {
    expect(averageSentenceLength('Un deux trois. Quatre cinq.')).toBe(2.5);
    expect(averageSentenceLength('')).toBe(0);
  });

  it('passes a good answer', () => {
    const results = checkDifferentiation(good, {
      levelKeys: ['L1', 'L2'],
      mustKeep: ['castor', 'barrage'],
      people: ['Léa'],
    });
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it('catches missing levels, lost content, anglicisms and leftover markers', () => {
    const bad: DifferentiateOutput = {
      ...good,
      versions: [{ ...good.versions[0]!, text: 'Élève A fait un email pendant le week-end.' }],
    };
    const failed = checkDifferentiation(bad, {
      levelKeys: ['L1', 'L2'],
      mustKeep: ['barrage'],
      people: [],
    })
      .filter((r) => !r.passed)
      .map((r) => r.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        'every level present once',
        'key content kept in every version',
        'no European French or anglicisms',
        'no leftover name markers after restore',
      ]),
    );
  });

  it('has ten cases with unique ids', () => {
    expect(differentiateCases).toHaveLength(10);
    expect(new Set(differentiateCases.map((c) => c.id)).size).toBe(10);
  });
});
