import { describe, expect, it } from 'vitest';
import { studentMarker, withoutStudentNames } from './feedback-names';

describe('feedback without students’ first names (D-116, Phase 6 review)', () => {
  const roster = ['Samuel', 'Marie-Ève', 'Léa', 'Rose'];

  it('replaces every first name of the roster, however it is written', () => {
    expect(
      withoutStudentNames(
        'Samuel et marie eve, puis LÉA et Lea, n’arrivent pas à ouvrir la leçon de Samuel.',
        roster,
        '[élève]',
      ),
    ).toEqual({
      text: '[élève] et [élève], puis [élève] et [élève], n’arrivent pas à ouvrir la leçon de [élève].',
      blocked: [],
    });
  });

  it('keeps everyday words, staff names and text without names as they are', () => {
    const text = 'La rose du jardin, Mme Tremblay et M. Leblanc : la page ne charge pas.';
    expect(withoutStudentNames(text, roster, '[élève]')).toEqual({ text, blocked: [] });
    expect(withoutStudentNames('Rose a oublié.', roster, '[student]').text).toBe(
      '[student] a oublié.',
    );
  });

  it('reports personal details for the sender to remove', () => {
    expect(
      withoutStudentNames('Appelez Samuel au 613-555-0199.', roster, '[élève]').blocked,
    ).toEqual(['phone']);
  });

  it('writes the marker in the sender’s language', () => {
    expect(studentMarker('fr-CA')).toBe('[élève]');
    expect(studentMarker('en-CA')).toBe('[student]');
  });
});
