import {
  newsletterTranslateFeature,
  newsletterTranslateInputSchema,
  type NewsletterTranslateInput,
} from '@lynx/ai/features/newsletter-translate';
import { prepareCall, type KnownPerson } from '@lynx/ai';
import { describe, expect, it } from 'vitest';
import { buildTranslatePreview, sameKeys } from './ai-preview';

const NOW = new Date('2026-10-08T12:00:00Z');

const people: KnownPerson[] = [
  { name: 'Samuel', kind: 'student' },
  { name: 'Aïcha', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
];

/** As `newsletter_ai_preview` returns it. */
const input: NewsletterTranslateInput = newsletterTranslateInputSchema.parse({
  newsletterId: '0f6c1c4e-8a5b-4d55-9a53-2f3b9a1d7e01',
  revision: 4,
  scope: 'missing',
  gradeLabels: ['3e année'],
  items: [
    ['message', 'Merci à Mme Dupuis et à Aïcha pour la collecte.'],
    ['message', 'Bravo à Samuel et à Aïcha ! Julie Lavoie viendra lire une histoire.'],
    ['reminders', 'Appelez le secrétariat au 613-555-1234.'],
    ['dates', 'Jeudi : sortie au Musée canadien de la nature avec Mme Tremblay.'],
  ].map(([section, text], i) => ({
    key: `P${i + 1}`,
    itemId: `item000${i}`,
    section,
    text,
  })),
  sendKeys: null,
});

describe('« Vérifier avant d’envoyer » for « Traduire en anglais (IA) » (D-139)', () => {
  const preview = buildTranslatePreview(input, people, NOW);
  const shown = preview.message.map((s) => s.text).join('');

  it('shows exactly the message the request sends, with the same markers', () => {
    const request = prepareCall(
      newsletterTranslateFeature,
      { ...input, sendKeys: preview.sendKeys },
      { systemPrompt: 'Traduis.', people, now: NOW },
    );
    if (!request.ok) throw new Error('refused');
    expect(shown).toBe(request.user);
    expect(preview.sendKeys).toEqual(['P2', 'P4']);
  });

  it('highlights the names the app knows, and counts only those sent', () => {
    expect(preview.message.filter((s) => s.placeholder).map((s) => s.text)).toEqual([
      'Élève B',
      'Élève A',
      'Adulte A',
    ]);
    expect(preview.replaced).toBe(3);
    expect(shown).not.toMatch(/Samuel|Aïcha|Tremblay|Dupuis|613/);
  });

  it('lists the paragraphs left out with the teacher’s own text and what was found', () => {
    expect(preview.notSent).toEqual([
      {
        key: 'P1',
        section: 'message',
        text: 'Merci à Mme Dupuis et à Aïcha pour la collecte.',
        reasons: [{ kind: 'titledName', match: 'Mme Dupuis' }],
      },
      {
        key: 'P3',
        section: 'reminders',
        text: 'Appelez le secrétariat au 613-555-1234.',
        reasons: [{ kind: 'phone', match: '613-555-1234' }],
      },
    ]);
  });

  it('lists the capitalized words to check in what is sent', () => {
    expect(preview.words).toEqual(['Julie', 'Lavoie', 'Musée']);
  });

  it('sends nothing when every paragraph is left out', () => {
    const only = { ...input, items: [input.items[0]!] };
    const empty = buildTranslatePreview(only, people, NOW);
    expect(empty.message).toEqual([]);
    expect(empty.sendKeys).toEqual([]);
    expect(empty.notSent).toHaveLength(1);
  });

  it('compares the confirmed keys whatever their order', () => {
    expect(sameKeys(['P4', 'P2'], ['P2', 'P4'])).toBe(true);
    expect(sameKeys(['P2'], ['P2', 'P4'])).toBe(false);
    expect(sameKeys(['P2', 'P3'], ['P2', 'P4'])).toBe(false);
  });
});
