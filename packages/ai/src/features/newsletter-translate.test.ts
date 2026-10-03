import { NEWSLETTER_LIMITS, NEWSLETTER_SECTIONS } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { DEMO_PEOPLE } from '../fixtures/demo-people';
import { Redactor, type KnownPerson } from '../privacy';
import { checkOutput, prepareCall } from '../run';
import {
  capitalizedWords,
  fakeNewsletterTranslation,
  frenchShare,
  markerCounts,
  NEWSLETTER_TRANSLATE_LIMITS,
  NEWSLETTER_TRANSLATE_SECTIONS,
  newsletterTranslateFeature,
  newsletterTranslateInputSchema,
  normalizeNewsletterTranslation,
  numbersOf,
  redactNewsletterTranslateInput,
  sameTimes,
  timesOf,
  translationProblems,
  validateNewsletterTranslation,
  type NewsletterTranslateInput,
} from './newsletter-translate';

const NOW = new Date('2026-10-08T12:00:00Z');
const ID = '0f6c1c4e-8a5b-4d55-9a53-2f3b9a1d7e01';

const people: KnownPerson[] = [
  { name: 'Samuel', kind: 'student' },
  { name: 'Aïcha', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
];

function input(
  texts: [section: NewsletterTranslateInput['items'][number]['section'], text: string][],
  extra: Partial<NewsletterTranslateInput> = {},
): NewsletterTranslateInput {
  return newsletterTranslateInputSchema.parse({
    newsletterId: ID,
    revision: 3,
    scope: 'missing',
    gradeLabels: ['3e année'],
    items: texts.map(([section, text], i) => ({
      key: `P${i + 1}`,
      itemId: `item${String(i).padStart(4, '0')}`,
      section,
      text,
    })),
    sendKeys: null,
    ...extra,
  });
}

const prepare = (raw: NewsletterTranslateInput, who: readonly KnownPerson[] = people) =>
  prepareCall(newsletterTranslateFeature, raw, { systemPrompt: 'Traduis.', people: who, now: NOW });

describe('the input', () => {
  it('has the message’s sections and limits', () => {
    expect([...NEWSLETTER_TRANSLATE_SECTIONS]).toEqual([...NEWSLETTER_SECTIONS]);
    expect(NEWSLETTER_TRANSLATE_LIMITS).toEqual({
      items: NEWSLETTER_LIMITS.items,
      fr: NEWSLETTER_LIMITS.fr,
      en: NEWSLETTER_LIMITS.en,
    });
  });

  it('refuses duplicate keys or ids, unknown confirmed keys, blank paragraphs and bad keys', () => {
    const ok = input([['message', 'Bonjour.']]);
    const parse = (patch: object) =>
      newsletterTranslateInputSchema.safeParse({ ...ok, ...patch }).success;
    expect(parse({})).toBe(true);
    const item = ok.items[0]!;
    expect(parse({ items: [item, { ...item, itemId: 'other123' }] })).toBe(false);
    expect(parse({ items: [item, { ...item, key: 'P2' }] })).toBe(false);
    expect(parse({ sendKeys: ['P2'] })).toBe(false);
    expect(parse({ sendKeys: ['P1', 'P1'] })).toBe(false);
    expect(parse({ sendKeys: [] })).toBe(false);
    expect(parse({ items: [{ ...item, text: '   ' }] })).toBe(false);
    expect(parse({ items: [{ ...item, key: 'P61' }] })).toBe(false);
    expect(parse({ items: [{ ...item, key: 'p1' }] })).toBe(false);
    expect(parse({ items: [] })).toBe(false);
    expect(parse({ scope: 'some' })).toBe(false);
  });
});

describe('what is sent', () => {
  it('replaces the people the app knows and puts them back in the answer', () => {
    const prepared = prepare(
      input([
        ['message', 'Bravo à Samuel et à Aïcha pour leur exposé !'],
        ['message', 'Mme Tremblay remercie les familles.'],
      ]),
    );
    if (!prepared.ok) throw new Error('refused');
    expect(prepared.user).toContain('<P1>\nBravo à Élève A et à Élève B pour leur exposé !\n</P1>');
    expect(prepared.user).toContain('<P2>\nAdulte A remercie les familles.\n</P2>');
    expect(prepared.user).not.toMatch(/Samuel|Aïcha|Tremblay/);
    const checked = checkOutput(
      newsletterTranslateFeature,
      {
        items: [
          { key: 'P1', text: 'Congratulations to Élève A and Élève B on their presentation!' },
          { key: 'P2', text: 'Adulte A thanks the families.' },
        ],
      },
      prepared.input,
      prepared.redactor,
    );
    expect(checked).toEqual({
      ok: true,
      output: {
        items: [
          { key: 'P1', text: 'Congratulations to Samuel and Aïcha on their presentation!' },
          { key: 'P2', text: 'Mme Tremblay thanks the families.' },
        ],
      },
    });
  });

  it('sends no id, class, school or signature: keys, sections and the grade only', () => {
    const raw = input([
      ['thisWeek', 'Mathématiques : « Les nombres jusqu’à 1 000 »'],
      ['closing', 'Bonne fin de semaine !'],
    ]);
    const prepared = prepare(raw);
    if (!prepared.ok) throw new Error('refused');
    expect(prepared.user).not.toContain(ID);
    for (const item of raw.items) expect(prepared.user).not.toContain(item.itemId);
    expect(prepared.user).toContain('Année d’études : 3e année.');
    expect(prepared.user).toContain('Section : Cette semaine en classe\n<P1>');
    expect(prepared.user).toContain('Section : Mot de la fin\n<P2>');
    expect(prepared.user).toMatch(/Paragraphes à traduire : 2\./);
  });

  it('leaves out a paragraph with a personal detail or a title before an unknown name', () => {
    const raw = input([
      ['message', 'Bravo à Samuel !'],
      ['reminders', 'Appelez le secrétariat au 613-555-1234.'],
      ['message', 'Merci à Mme Dupuis, qui a accompagné la sortie.'],
      ['message', 'Merci à Mme Tremblay pour la sortie.'],
      ['reminders', 'Écrivez à julie.dupuis@example.com.'],
    ]);
    const { input: sent, notSent } = redactNewsletterTranslateInput(raw, new Redactor(people, NOW));
    expect(sent.items.map((i) => i.key)).toEqual(['P1', 'P4']);
    expect(notSent.map((n) => [n.key, n.kinds])).toEqual([
      ['P2', ['phone']],
      ['P3', ['titledName']],
      ['P5', ['email']],
    ]);
    expect(notSent[1]!.findings[0]!.match).toBe('Mme Dupuis');

    const prepared = prepare(raw);
    if (!prepared.ok) throw new Error('refused');
    expect(prepared.user).not.toMatch(/613|Dupuis|julie/);
    // Paths only in the logs: the keys.
    expect(prepared.problems).toEqual(['dropped items.P2', 'dropped items.P3', 'dropped items.P5']);
  });

  it('refuses the request when nothing is left to send (personalInfo)', () => {
    const prepared = prepare(input([['message', 'Merci à Mme Dupuis.']]));
    expect(prepared).toMatchObject({ ok: false, errorCode: 'personalInfo' });
  });

  it('sends only the paragraphs the teacher confirmed, with the preview’s markers', () => {
    const texts: [NewsletterTranslateInput['items'][number]['section'], string][] = [
      ['message', 'Merci à Mme Dupuis et à Aïcha.'],
      ['message', 'Bravo à Samuel et à Aïcha !'],
      ['dates', 'Jeudi : sortie au musée.'],
    ];
    const preview = prepare(input(texts));
    const request = prepare(input(texts, { sendKeys: ['P2'] }));
    if (!preview.ok || !request.ok) throw new Error('refused');
    // The preview sends P2 and P3; the teacher confirmed P2 only.
    expect(preview.input.items.map((i) => i.key)).toEqual(['P2', 'P3']);
    expect(request.input.items.map((i) => i.key)).toEqual(['P2']);
    // Aïcha was met first in P1 (left out): the same marker in the preview and the request.
    expect(request.user).toContain('<P2>\nBravo à Élève B et à Élève A !\n</P2>');
    expect(preview.user).toContain('<P2>\nBravo à Élève B et à Élève A !\n</P2>');
    expect(request.problems).toEqual(['dropped items.P1', 'dropped items.P3 unconfirmed']);
  });

  it('refuses at the last check a title before an unknown name anywhere in the message', () => {
    const feature = {
      ...newsletterTranslateFeature,
      // A redaction that would let a paragraph through: the last check still refuses.
      redactInput: (i: NewsletterTranslateInput) => ({ input: i, blocked: [] }),
    };
    const prepared = prepareCall(feature, input([['message', 'Merci à Mme Dupuis.']]), {
      systemPrompt: 'Traduis.',
      people,
      now: NOW,
    });
    expect(prepared).toEqual({
      ok: false,
      errorCode: 'personalInfo',
      problems: ['outbound titledName'],
    });
  });

  it('works with the demo database’s people', () => {
    const prepared = prepare(
      input([['message', 'Bravo à Léa, Samuel et Rosalie ! Mme Tremblay est fière.']]),
      DEMO_PEOPLE,
    );
    if (!prepared.ok) throw new Error('refused');
    expect(prepared.user).toContain('Bravo à Élève A, Élève B et Élève C ! Adulte A est fière.');
  });
});

describe('capitalizedWords: words to check before sending', () => {
  it('lists capitalized words inside sentences, never markers, titles or common words', () => {
    expect(
      capitalizedWords([
        'Bonjour chères familles,',
        'Merci à Julie et à Élève A pour la collecte organisée avec la paroisse Sainte-Famille.',
        'Les élèves de 3e année visiteront le Musée canadien de la nature avec Adulte B.',
        'Rappel : la journée PA est vendredi. Noël approche, et Dieu nous aime.',
      ]),
    ).toEqual(['Julie', 'Musée']);
  });

  it('lists a sentence’s first word only when the next one is listed too (a full name)', () => {
    expect(capitalizedWords(['Julie Dupuis viendra lire une histoire.'])).toEqual([
      'Julie',
      'Dupuis',
    ]);
    expect(capitalizedWords(['Demain, nous irons au parc.'])).toEqual([]);
    expect(capitalizedWords(['Les Dupuis viendront. Merci à Son et à Bon.'])).toEqual([
      'Dupuis',
      'Son',
      'Bon',
    ]);
    expect(capitalizedWords(['« Les Nombres » est notre unité.'])).toEqual(['Nombres']);
  });

  it('finds a name after an elision, each word once', () => {
    expect(capitalizedWords(['Le livre d’Hélène.', 'Hélène et Hélène.'])).toEqual(['Hélène']);
  });
});

describe('the answer', () => {
  const raw = input([
    ['dates', 'Jeudi 15 octobre : départ hâtif à 13 h 35.'],
    ['reminders', 'Apportez 2,50 $ pour la collation et 1 000 sourires.'],
    ['message', 'Bravo à Élève A !'],
  ]);

  it('normalizes the form for free', () => {
    expect(
      normalizeNewsletterTranslation({
        items: [
          { key: ' p1 ', text: '  Reminder : the unit « Numbers to 1,000 » starts !  ' },
          { key: 'P2', text: 'Ready?\u00a0Yes\u202f!' },
        ],
      }),
    ).toEqual({
      items: [
        { key: 'P1', text: 'Reminder: the unit “Numbers to 1,000” starts!' },
        { key: 'P2', text: 'Ready?\u00a0Yes!' },
      ],
    });
  });

  it('accepts a faithful translation', () => {
    expect(
      validateNewsletterTranslation(
        {
          items: [
            { key: 'P1', text: 'Thursday, October 15: early dismissal at 1:35 p.m.' },
            { key: 'P2', text: 'Bring $2.50 for the snack and 1,000 smiles.' },
            { key: 'P3', text: 'Congratulations to Élève A!' },
          ],
        },
        raw,
      ),
    ).toEqual([]);
  });

  it('wants every key sent, each once, and no other', () => {
    expect(
      validateNewsletterTranslation(
        {
          items: [
            { key: 'P1', text: 'Thursday, October 15: early dismissal at 1:35 p.m.' },
            { key: 'P1', text: 'Thursday, October 15: early dismissal at 1:35 p.m.' },
            { key: 'P9', text: 'Hello.' },
          ],
        },
        raw,
      ),
    ).toEqual(['P1: duplicate', 'items.2: unknown key', 'P2: missing', 'P3: missing']);
  });

  it('checks each paragraph: empty, length, markers, numbers, times and French left', () => {
    expect(translationProblems('Bravo !', '  ')).toEqual(['empty']);
    expect(translationProblems('Bravo !', 'x'.repeat(95))).toEqual(['tooLong']);
    expect(translationProblems('Bravo à Élève A !', 'Congratulations!')).toEqual(['markers']);
    expect(translationProblems('Bravo à Élève A !', 'Well done, Élève A and Élève A!')).toEqual([
      'markers',
    ]);
    expect(translationProblems('Bravo à Élève A !', 'Well done, Student A! Élève A')).toEqual([
      'englishMarker',
    ]);
    expect(translationProblems('Apportez 2,50 $.', 'Bring $2.')).toEqual(['numbers']);
    expect(translationProblems('Départ à 13 h 35.', 'Dismissal at 1:30 p.m.')).toEqual(['times']);
    expect(translationProblems('Départ à 13 h 35.', 'Dismissal at 1:35 a.m.')).toEqual(['times']);
    expect(translationProblems('Bravo à Élève A !', 'Bravo à Élève A !')).toEqual(['french']);
    expect(
      translationProblems(
        'Les élèves de la classe vont au parc avec leurs amis et leurs familles.',
        'The students de la classe vont au parc avec leurs friends et leurs families.',
      ),
    ).toEqual(['french']);
    // Quoted titles are left out of the French count.
    expect(
      translationProblems(
        'Nous commencerons l’unité « Les nombres jusqu’à 1 000 et plus encore ».',
        'We will start the unit “Les nombres jusqu’à 1 000 et plus encore”.',
      ),
    ).toEqual([]);
  });

  it('reads times the French and the English way', () => {
    const fr = timesOf('Messe à 9 h 45, départ à 13h35, dîner à midi, retour à 15 h.', 'fr');
    expect(fr.times.map((t) => t.minutes)).toEqual([585, 815, 900, 720]);
    const en = timesOf('Mass at 9:45 a.m., leaving at 1:35 PM, lunch at noon, back at 3:00.', 'en');
    expect(en.times.map((t) => [t.minutes, t.either])).toEqual([
      [585, false],
      [815, false],
      [180, true],
      [720, false],
    ]);
    expect(sameTimes(fr.times, en.times)).toBe(true);
    expect(timesOf('dans l’après-midi, 3 heures de route', 'fr').times).toEqual([]);
  });

  it('reads numbers with their separators', () => {
    expect(numbersOf('Le 1er novembre, 1 000 $ et 2,50 $ pour 3e année')).toEqual(
      numbersOf('November 1st, $1,000 and $2.50 for Grade 3'),
    );
    expect(numbersOf('2,50')).toEqual(['250']);
    expect(numbersOf('08')).toEqual(['8']);
  });

  it('counts French words, quoted titles and markers aside', () => {
    expect(frenchShare('Élève A et Élève B').share).toBe(1);
    expect(frenchShare('“Les amis de la forêt” is our book.').share).toBe(0);
    expect(frenchShare('Thanks to Élève A for the help.').share).toBe(0);
  });

  it('counts markers', () => {
    expect([...markerCounts('Élève A, élève A et Adulte B')]).toEqual([
      ['Élève A', 2],
      ['Adulte B', 1],
    ]);
  });

  it('has a fake answer that passes every check', () => {
    const fake = fakeNewsletterTranslation(raw);
    expect(fake.items.map((i) => i.text)).toEqual([
      'Demo translation: Thursday, 15, October, early dismissal, 1:35 p.m.',
      'Demo translation: 2.50, 1,000.',
      'Demo translation: Élève A.',
    ]);
    expect(validateNewsletterTranslation(normalizeNewsletterTranslation(fake), raw)).toEqual([]);
  });
});
