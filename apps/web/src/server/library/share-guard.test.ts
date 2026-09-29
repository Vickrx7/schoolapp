import { findPersonalInfo as privacyFindPersonalInfo, type KnownPerson } from '@lynx/ai/privacy';
import { sampleCanonical } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  findPersonalInfo,
  guardVerdict,
  itemStrings,
  proseStrings,
  unconfirmedNames,
  type GuardedItem,
} from './share-guard';

const PEOPLE: KnownPerson[] = [
  { name: 'Samuel', kind: 'student' },
  { name: 'Aïcha', kind: 'student' },
  { name: 'Rose', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
  { name: 'Marc Gagnon', kind: 'staff' },
];

function item(over: Partial<GuardedItem> = {}): GuardedItem {
  const { content, answerKey } = sampleCanonical('quiz');
  return {
    title: 'Quiz : les nombres',
    summary: null,
    materials: 'Crayons',
    keywords: 'nombres',
    catholicConnection: null,
    safetyNotes: null,
    versions: [{ content, answerKey }],
    ...over,
  };
}

describe('the first-name guard', () => {
  it('finds a student’s name in any version string or key', () => {
    const { content, answerKey } = sampleCanonical('quiz');
    const inContent = structuredClone(content);
    (inContent.questions[0] as { prompt: string }).prompt = 'Samuel compte jusqu’à 1 000.';
    expect(
      findPersonalInfo(
        itemStrings(item({ versions: [{ content: inContent, answerKey }] })),
        PEOPLE,
      ),
    ).toEqual({ studentNames: ['Samuel'], blocked: [] });

    const inKey = structuredClone(answerKey)!;
    inKey.solution = 'Demandez à aicha de lire la réponse.';
    const level = { content, answerKey: inKey };
    // The roster spelling comes back, whatever the accents typed.
    expect(
      findPersonalInfo(itemStrings(item({ versions: [{ content, answerKey }, level] })), PEOPLE)
        .studentNames,
    ).toEqual(['Aïcha']);

    expect(
      findPersonalInfo(itemStrings(item({ summary: 'Pour Samuel et Aïcha.' })), PEOPLE),
    ).toEqual({ studentNames: ['Samuel', 'Aïcha'], blocked: [] });
  });

  it('uses the privacy package’s check (its own tests are in packages/ai privacy.test.ts)', () => {
    expect(findPersonalInfo).toBe(privacyFindPersonalInfo);
  });

  it('always blocks e-mail addresses and phone numbers', () => {
    const found = findPersonalInfo(
      ['Écrivez à parent.samuel@example.com', 'Appelez le 613-555-0142.'],
      PEOPLE,
    );
    expect(found.blocked.sort()).toEqual(['email', 'phone']);
    expect(guardVerdict(found, ['Samuel'])).toEqual({
      ok: false,
      names: found.studentNames,
      blocked: found.blocked,
    });
  });

  it('lets confirmed names through, one by one', () => {
    const found = findPersonalInfo(
      ['Samuel de Champlain et saint Thomas.'],
      [...PEOPLE, { name: 'Thomas', kind: 'student' }],
    );
    expect(found.studentNames).toEqual(['Samuel', 'Thomas']);
    expect(guardVerdict(found, [])).toEqual({
      ok: false,
      names: ['Samuel', 'Thomas'],
      blocked: [],
    });
    expect(unconfirmedNames(found.studentNames, ['samuel'])).toEqual(['Thomas']);
    expect(guardVerdict(found, ['samuel', 'THOMAS'])).toEqual({ ok: true, namesConfirmed: 2 });
    expect(guardVerdict(findPersonalInfo(['Rien à signaler.'], PEOPLE), [])).toEqual({
      ok: true,
      namesConfirmed: 0,
    });
  });

  it('reads prose only, never ids or kinds', () => {
    expect(
      proseStrings({
        id: 'Samuel',
        kind: 'short_answer',
        prompt: 'Une question',
        list: ['a', ' '],
      }),
    ).toEqual(['Une question', 'a']);
    expect(
      itemStrings(item({ safetyNotes: { supervision: 'standard', notes: 'Des lunettes' } })),
    ).toContain('Des lunettes');
  });
});
