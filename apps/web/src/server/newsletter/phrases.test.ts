import {
  buildNewsletterDraft,
  newsletterContentSchema,
  newsletterPlainText,
  type NewsletterFacts,
} from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import {
  newsletterHeader,
  newsletterHeadings,
  newsletterPhrasePair,
  tipSentence,
  type MessageCatalog,
} from './phrases';

const pair = newsletterPhrasePair({ fr, en: en as MessageCatalog });
const NBSP = '\u00a0';

describe('the family-facing sentences (D-137), from the real catalogues', () => {
  it('writes dates in words with « 1er », and times as families read them', () => {
    expect(
      pair.fr.earlyDismissal({ date: '2026-12-01', time: '13:35', title: 'Départ hâtif' }),
    ).toBe(`Mardi 1er décembre${NBSP}: départ hâtif à 13 h 35`);
    expect(
      pair.en.earlyDismissal({ date: '2026-12-01', time: '13:35', title: 'Départ hâtif' }),
    ).toBe('Tuesday, December 1: early dismissal at 1:35 p.m.');
    // A title that says more than the type comes after the line.
    expect(
      pair.fr.earlyDismissal({
        date: '2026-11-19',
        time: '13:35',
        title: 'Rencontres parents-enseignants',
      }),
    ).toBe(`Jeudi 19 novembre${NBSP}: départ hâtif à 13 h 35 (Rencontres parents-enseignants)`);
    expect(
      pair.en.earlyDismissal({
        date: '2026-11-19',
        time: '13:35',
        title: 'Rencontres parents-enseignants',
      }),
    ).toBe(
      'Thursday, November 19: early dismissal at 1:35 p.m. (“Rencontres parents-enseignants”)',
    );
    expect(pair.fr.lateStart({ date: '2026-10-07', time: '10:00', title: 'Entrée retardée' })).toBe(
      `Mercredi 7 octobre${NBSP}: entrée retardée, les classes commencent à 10 h`,
    );
  });

  it('names a day off by its title, or by its type when the title only repeats it', () => {
    expect(
      pair.fr.dayOff({
        from: '2026-10-09',
        to: '2026-10-09',
        title: 'Journée pédagogique',
        type: 'pa_day',
      }),
    ).toBe(`Vendredi 9 octobre${NBSP}: journée pédagogique (pas d’école)`);
    expect(
      pair.en.dayOff({
        from: '2026-10-09',
        to: '2026-10-09',
        title: 'Journée pédagogique',
        type: 'pa_day',
      }),
    ).toBe('Friday, October 9: PA day (no school)');
    expect(
      pair.en.dayOff({
        from: '2026-10-12',
        to: '2026-10-12',
        title: 'Action de grâce',
        type: 'holiday',
      }),
    ).toBe('Monday, October 12: Holiday, “Action de grâce” (no school)');
    expect(
      pair.fr.dayOff({
        from: '2026-12-21',
        to: '2027-01-01',
        title: 'Congé des Fêtes',
        type: 'holiday',
      }),
    ).toBe(`Du lundi 21 décembre au vendredi 1er janvier${NBSP}: Congé des Fêtes (pas d’école)`);
  });

  it('events: the title as typed, the type first in English; never the event’s notes', () => {
    const mass = {
      from: '2026-10-08',
      to: '2026-10-08',
      time: '10:00',
      title: 'Messe de l’Action de grâce',
      type: 'mass' as const,
    };
    expect(pair.fr.event(mass)).toBe(`Jeudi 8 octobre à 10 h${NBSP}: Messe de l’Action de grâce`);
    expect(pair.en.event(mass)).toBe(
      'Thursday, October 8 at 10:00 a.m.: Mass, “Messe de l’Action de grâce”',
    );
    expect(pair.fr.event({ ...mass, time: null, title: 'Messe' })).toBe(
      `Jeudi 8 octobre${NBSP}: messe`,
    );
  });

  it('lessons, a unit starting, reports and seasons', () => {
    const line = {
      subject: 'Mathématiques',
      unit: 'Les nombres jusqu’à 1 000',
      lessons: ['Comparer des nombres', 'Ordonner des nombres'],
    };
    expect(pair.fr.lessons(line)).toBe(
      `Mathématiques (unité «${NBSP}Les nombres jusqu’à 1 000${NBSP}»)${NBSP}: «${NBSP}Comparer des nombres${NBSP}» et «${NBSP}Ordonner des nombres${NBSP}»`,
    );
    expect(pair.en.lessons({ ...line, subject: 'Mathematics' })).toBe(
      'Mathematics (unit “Les nombres jusqu’à 1 000”): “Comparer des nombres” and “Ordonner des nombres”',
    );
    expect(
      pair.fr.unitStart({ subject: 'Mathématiques', title: 'L’addition', date: '2026-10-13' }),
    ).toBe(`Mathématiques${NBSP}: nous commencerons l’unité «${NBSP}L’addition${NBSP}»`);
    expect(pair.fr.report({ date: '2026-11-13', period: 'progress' })).toBe(
      `Vendredi 13 novembre${NBSP}: remise du bulletin de progrès`,
    );
    expect(pair.en.report({ date: '2026-11-13', period: 'progress' })).toBe(
      'Friday, November 13: the Progress Report Card goes home',
    );
    expect(pair.fr.season({ date: '2026-11-29', season: 'avent' })).toBe(
      `Dimanche 29 novembre${NBSP}: premier dimanche de l’Avent`,
    );
    expect(pair.en.season({ date: '2026-11-29', season: 'avent' })).toBe(
      'Sunday, November 29: First Sunday of Advent',
    );
  });

  it('tips become sentences; the faith moment follows the reference’s type', () => {
    expect(tipSentence('compter par 10 en marchant', 'fr-CA')).toBe('Compter par 10 en marchant.');
    expect(tipSentence('Est-il plus grand que 500?', 'fr-CA')).toBe('Est-il plus grand que 500?');
    expect(
      pair.fr.faith({ type: 'prayer', title: 'Prière', text: 'Seigneur, aide-moi. Amen.' }),
    ).toBe(`Cette semaine, nous prions ensemble${NBSP}: «${NBSP}Seigneur, aide-moi. Amen.${NBSP}»`);
    expect(pair.en.faith({ type: 'prayer', title: 'Prière', text: 'Lord, help me. Amen.' })).toBe(
      'This week, we pray together: “Lord, help me. Amen.”',
    );
    expect(
      pair.fr.faith({ type: 'reflection', title: 'Dire merci', text: 'Nomme trois personnes.' }),
    ).toBe(`Une question à discuter en famille${NBSP}: Nomme trois personnes.`);
  });

  it('the header and the headings, in each language', () => {
    const values = { school: 'École Saint-Exemple', className: '3e année', weekOf: '2026-03-01' };
    expect(newsletterHeader('fr-CA', fr, values)).toBe(
      'École Saint-Exemple · 3e année · Semaine du 1er mars 2026',
    );
    expect(newsletterHeader('en-CA', en as MessageCatalog, values)).toBe(
      'École Saint-Exemple · 3e année · Week of March 1, 2026',
    );
    expect(newsletterHeadings('fr-CA', fr).thisWeek).toBe('Cette semaine en classe');
    expect(newsletterHeadings('en-CA', en as MessageCatalog).atHome).toBe('Helping at home');
  });
});

describe('a week with many long lessons (post-MVP review)', () => {
  it('lists the first lessons and « et N autres leçons » rather than refusing the message', () => {
    // Français twice a day: eleven lessons of 85 characters (the database allows 160).
    const title = (i: number) =>
      `Lecture guidée ${i} : repérer les caractéristiques du texte informatif (manuel p. 12-15)`;
    const facts: NewsletterFacts = {
      weekOf: '2026-10-05',
      thisWeek: [
        {
          subjectId: 'fra',
          subject: { fr: 'Français', en: 'French' },
          unitId: 'u',
          unitTitle: 'Lire pour s’informer : les animaux de l’Ontario',
          lessons: Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, title: title(i + 1) })),
        },
      ],
      nextWeek: [],
      nextLessonsOnly: false,
      unitStarts: [],
      dates: [],
      guides: [],
      faith: null,
    };
    let n = 0;
    const content = buildNewsletterDraft(
      facts,
      pair,
      { signature: 'Mme Tremblay', faith: false, guides: false },
      () => `item${String(n++).padStart(4, '0')}`,
    );
    expect(newsletterContentSchema.safeParse(content).success).toBe(true);
    const line = content.sections.find((s) => s.key === 'thisWeek')!.items[0]!;
    expect(line.fr.length).toBeLessThanOrEqual(1000);
    expect(line.en.length).toBeLessThanOrEqual(1500);
    // Ten titles fit in French's 1,000 characters; the eleventh is counted.
    expect(line.fr).toMatch(/» et 1 autre leçon$/);
    expect(line.fr).toMatch(/«\sLecture guidée 10\s/u);
    expect(line.fr).not.toMatch(/Lecture guidée 11\s/u);
    expect(line.en).toMatch(/ other lessons?$/);
  });
});

describe('a whole draft from the catalogues', () => {
  it('is valid content whose text reads in both languages', () => {
    const facts: NewsletterFacts = {
      weekOf: '2026-10-05',
      thisWeek: [
        {
          subjectId: 's',
          subject: { fr: 'Mathématiques', en: 'Mathematics' },
          unitId: 'u',
          unitTitle: 'Les nombres jusqu’à 1 000',
          lessons: [{ id: 'l', title: 'Comparer des nombres' }],
        },
      ],
      nextWeek: [],
      nextLessonsOnly: false,
      unitStarts: [],
      dates: [{ kind: 'report', from: '2026-10-20', period: 'progress' }],
      guides: [{ id: 'g', title: 'Guide', tips: [{ fr: 'compter par 10', en: 'count by 10s' }] }],
      faith: null,
    };
    let n = 0;
    const content = buildNewsletterDraft(
      facts,
      pair,
      { signature: 'Mme Tremblay', faith: true, guides: true },
      () => `item${String(n++).padStart(4, '0')}`,
    );
    expect(newsletterContentSchema.safeParse(content).success).toBe(true);
    const headings = {
      fr: newsletterHeadings('fr-CA', fr),
      en: newsletterHeadings('en-CA', en as MessageCatalog),
    };
    const header = {
      fr: 'École · 3e année · Semaine du 5 octobre 2026',
      en: 'École · 3e année · Week of October 5, 2026',
    };
    const text = newsletterPlainText(content, { lang: 'both', header, headings });
    expect(text).toContain('Bonjour chères familles,');
    expect(text).toContain('Pour aider à la maison\n• Compter par 10.');
    expect(text).toContain('Dear families,');
    expect(text).toContain('Helping at home\n• Count by 10s.');
    expect(text).toContain('Bonne fin de semaine!\n\nMme Tremblay');
    expect(text).toContain('Have a good weekend!\n\nMme Tremblay');
  });
});
