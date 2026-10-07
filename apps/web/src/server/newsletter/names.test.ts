import { emptyNewsletterContent, typedItem, type NewsletterContent } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { newsletterNames, newsletterTexts } from './names';

const ROSTER = ['Samuel', 'Aïcha', 'Rose', 'Léa'];

function content(paragraphs: string[], off = false): NewsletterContent {
  const base = emptyNewsletterContent('Mme Tremblay');
  return {
    ...base,
    sections: base.sections.map((s) =>
      s.key === 'message'
        ? { ...s, items: paragraphs.map((p, i) => typedItem(`para000${i}`, p)) }
        : s.key === 'reminders'
          ? { ...s, off, items: [typedItem('remind01', 'Bravo à Léa pour son dessin!')] }
          : s,
    ),
  };
}

describe('« Des élèves sont nommés » (D-138)', () => {
  it('lists the class’s students named, in the order found', () => {
    expect(
      newsletterNames(
        content(['Bravo à Samuel et à Aïcha pour leur exposé!', 'Merci à Samuel.']),
        ROSTER,
      ),
    ).toEqual({ studentNames: ['Samuel', 'Aïcha', 'Léa'], details: [] });
  });

  it('a name that is also a word counts only with its capital; staff names are not looked for', () => {
    expect(newsletterNames(content(['Une rose pour Mme Tremblay.']), ROSTER).studentNames).toEqual([
      'Léa',
    ]);
  });

  it('leaves out a removed section', () => {
    expect(newsletterNames(content(['Bonjour!'], true), ROSTER).studentNames).toEqual([]);
    expect(newsletterTexts(content(['Bonjour!'], true))).toEqual(['Bonjour!']);
  });

  it('points out personal details, each once, without blocking', () => {
    const found = newsletterNames(
      content([
        'Pour toute question, appelez le 613-555-1234 ou le 613-555-1234.',
        'Écrivez à parent.benevole@example.com.',
      ]),
      ROSTER,
    );
    expect(found.details).toEqual([
      { kind: 'phone', match: '613-555-1234' },
      { kind: 'email', match: 'parent.benevole@example.com' },
    ]);
  });
});
