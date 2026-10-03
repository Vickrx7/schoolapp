import type { NewsletterContent } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import {
  editedNewsletter,
  NEWSLETTER_LABELS,
  newsletterDraft,
  newsletterInput,
  newsletterModel,
} from './newsletter-fixtures';
import {
  buildNewsletterPdfModel,
  newsletterPdfLanguage,
  printedText,
  type NewsletterPdfPage,
} from './newsletter-model';

const NBSP = '\u00a0';
/** A page's text with plain spaces, to read it as the families do. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
const sectionOf = (page: NewsletterPdfPage, key: string) =>
  page.sections.find((s) => s.key === key);
const texts = (page: NewsletterPdfPage, key: string) =>
  sectionOf(page, key)?.paragraphs.map((p) => plain(p.text)) ?? [];

describe('the « Info-parents » PDF model (D-141)', () => {
  it('both languages: the French page, then the English page, each with its header and signature', () => {
    const model = newsletterModel();
    expect(model.pages.map((p) => p.lang)).toEqual(['fr', 'en']);
    const [fr, en] = model.pages as [NewsletterPdfPage, NewsletterPdfPage];
    expect(fr.header).toEqual({
      school: 'École élémentaire catholique Saint-Exemple',
      title: 'Info-parents',
      className: '3e année – Mme Tremblay',
      week: `Semaine du 5${NBSP}octobre${NBSP}2026`,
    });
    expect(en.header).toMatchObject({
      title: 'Family newsletter',
      week: `Week of October${NBSP}5,${NBSP}2026`,
    });
    expect(fr.signature).toBe('Mme Tremblay');
    expect(en.signature).toBe('Mme Tremblay');
    expect(plain(fr.footer)).toBe(
      'Info-parents · 3e année – Mme Tremblay · Semaine du 5 octobre 2026',
    );
    expect(plain(en.footer)).toBe(
      'Family newsletter · 3e année – Mme Tremblay · Week of October 5, 2026',
    );
    expect(fr.page(1, 2)).toBe('Page 1 sur 2');
    expect(en.page(1, 2)).toBe('Page 1 of 2');
    expect(model.info).toEqual({
      title: 'Info-parents · 3e année – Mme Tremblay · Semaine du 5 octobre 2026',
      language: 'fr-CA',
    });
    expect(model.fileName).toBe('info-parents-3e-annee-mme-tremblay-2026-10-05.pdf');
  });

  it('prints the sections the editor shows, with each language’s headings', () => {
    const [fr, en] = newsletterModel().pages as [NewsletterPdfPage, NewsletterPdfPage];
    expect(fr.sections.map((s) => [s.key, s.heading, s.style])).toEqual([
      ['message', null, 'text'],
      ['thisWeek', 'Cette semaine en classe', 'list'],
      ['nextWeek', 'La semaine prochaine', 'list'],
      ['dates', 'Dates à retenir', 'list'],
      ['reminders', 'Rappels', 'list'],
      ['atHome', 'Pour aider à la maison', 'list'],
      ['faith', 'Moment de foi', 'faith'],
      ['closing', null, 'text'],
    ]);
    expect(en.sections.map((s) => s.heading)).toEqual([
      null,
      'This week in class',
      'Next week',
      'Dates to remember',
      'Reminders',
      'Helping at home',
      'Faith moment',
      null,
    ]);
    expect(texts(fr, 'message')).toEqual([
      'Bonjour chères familles,',
      'Quelle belle semaine! Nous avons visité la bibliothèque municipale et chaque élève a choisi un livre sur les animaux du Canada.',
    ]);
    expect(texts(fr, 'dates')).toEqual([
      'Vendredi 9 octobre : journée pédagogique (pas d’école).',
      'Lundi 12 octobre : Action de grâce (pas d’école).',
      'Mardi 13 octobre à 13 h 15 : Spectacle de la chorale.',
      'Jeudi 22 octobre : remise du bulletin de progrès.',
    ]);
    expect(texts(en, 'dates')).toContain(
      'Tuesday, October 13 at 1:15 p.m.: Assembly, “Spectacle de la chorale”.',
    );
    expect(texts(fr, 'faith')).toEqual([
      'Cette semaine, nous prions ensemble : « Seigneur, aide-moi à bien écouter, à faire de mon mieux et à aider mes amis aujourd’hui. Amen. »',
    ]);
    expect(texts(en, 'faith')[0]).toMatch(/^This week, we pray together: “Lord, help me/);
    expect(texts(fr, 'closing')).toEqual(['Bonne fin de semaine!']);
    expect(texts(en, 'closing')).toEqual(['Have a good weekend!']);
  });

  it('the English page: the French of a paragraph without an up-to-date English version', () => {
    const [fr, en] = newsletterModel().pages as [NewsletterPdfPage, NewsletterPdfPage];
    // Her own English, the app's English.
    expect(sectionOf(en, 'message')!.paragraphs).toEqual([
      { text: 'Dear families,', inFrench: false },
      {
        text: 'What a great week! We visited the public library and every student chose a book about Canada’s animals.',
        inFrench: false,
      },
    ]);
    // A lesson line whose French she edited: its English is out of date, so the French.
    const [edited, other] = sectionOf(en, 'thisWeek')!.paragraphs;
    expect(edited!.inFrench).toBe(true);
    expect(plain(edited!.text)).toMatch(
      /^Mathématiques \(unité « Les nombres.*Bravo à toute la classe!$/,
    );
    expect(other).toEqual({
      text: 'French (unit “Les animaux du Canada”): “Le castor, bâtisseur de barrages”.',
      inFrench: false,
    });
    // A reminder without English.
    expect(sectionOf(en, 'reminders')!.paragraphs).toEqual([
      {
        text: `Merci d’apporter une boîte de mouchoirs pour la classe d’ici le vendredi 16${NBSP}octobre.`,
        inFrench: true,
      },
    ]);
    expect(en.inFrenchLabel).toBe('(in French)');
    // The French page is French throughout.
    expect(fr.sections.flatMap((s) => s.paragraphs).some((p) => p.inFrench)).toBe(false);
    expect(fr.inFrenchLabel).toBe('(en français)');
    // The out-of-date English is printed nowhere.
    expect(JSON.stringify(en)).not.toContain('“Lire et écrire des nombres jusqu’à 1 000”');
  });

  it('says so when some of the English was translated automatically, and only then', () => {
    expect(newsletterModel().pages.map((p) => p.note)).toEqual([null, null]);
    const content = editedNewsletter();
    const news = content.sections[0]!.items[1]!;
    content.sections[0]!.items[1] = { ...news, enBy: 'ai' };
    const [fr, en] = newsletterModel({ content }).pages;
    expect(fr!.note).toBeNull();
    expect(en!.note).toBe('Some parts of this English version were translated automatically.');
    // The AI's English for an older French is not printed (the French is), so no note.
    content.sections[0]!.items[1] = { ...news, enBy: 'ai', fr: `${news.fr} Merci!` };
    expect(newsletterModel({ content, lang: 'en' }).pages[0]!.note).toBeNull();
  });

  it('leaves out removed and empty sections, empty paragraphs and an empty signature', () => {
    const content: NewsletterContent = newsletterDraft();
    content.signature = '  ';
    for (const s of content.sections) {
      if (s.key === 'dates' || s.key === 'faith') s.off = true;
      if (s.key === 'atHome') s.items = s.items.map((i) => ({ ...i, fr: ' ', en: '' }));
    }
    const [fr, en] = newsletterModel({ content }).pages;
    for (const page of [fr!, en!]) {
      expect(page.sections.map((s) => s.key)).toEqual([
        'message',
        'thisWeek',
        'nextWeek',
        'closing',
      ]);
      expect(page.signature).toBeNull();
    }
    expect(JSON.stringify(fr)).not.toContain('Prière');
    expect(JSON.stringify(en)).not.toContain('Progress Report Card');
  });

  it('one language: its page only, named for it', () => {
    const fr = newsletterModel({ lang: 'fr' });
    expect(fr.pages.map((p) => p.lang)).toEqual(['fr']);
    expect(fr.fileName).toBe('info-parents-3e-annee-mme-tremblay-2026-10-05-fr.pdf');
    const en = newsletterModel({ lang: 'en' });
    expect(en.pages.map((p) => p.lang)).toEqual(['en']);
    expect(en.info).toEqual({
      title: 'Family newsletter · 3e année – Mme Tremblay · Week of October 5, 2026',
      language: 'en-CA',
    });
    expect(en.fileName).toBe('family-newsletter-3e-annee-mme-tremblay-2026-10-05.pdf');
  });

  it('holds nothing the editor does not show: no ids, sources or out-of-date English', () => {
    const input = newsletterInput();
    const json = JSON.stringify(buildNewsletterPdfModel(input, NEWSLETTER_LABELS));
    for (const item of input.content.sections.flatMap((s) => s.items)) {
      expect(json).not.toContain(`"${item.id}"`);
      if (item.from.ref) expect(json).not.toContain(item.from.ref);
    }
    expect(json).not.toMatch(/"(enFrom|enBy|from|ref|id)"/);
  });

  it('`?lang=`: both by default, French or English; nothing else', () => {
    expect(newsletterPdfLanguage(null)).toBe('both');
    expect(newsletterPdfLanguage('both')).toBe('both');
    expect(newsletterPdfLanguage('fr')).toBe('fr');
    expect(newsletterPdfLanguage('en')).toBe('en');
    expect(newsletterPdfLanguage('es')).toBeNull();
    expect(newsletterPdfLanguage('')).toBeNull();
  });
});

describe('printedText: the teacher’s words, with the spaces a line must not break at', () => {
  it('French: inside « », before its punctuation, in times, numbers and dates', () => {
    const typed =
      'Rappel : la sortie « Au musée » est le 1er décembre à 13 h 35 ! Apportez 2,50 $ ; nous comptons jusqu’à 1 000 ?';
    const printed = printedText(typed, 'fr');
    // The same characters, but for the kind of space.
    expect(plain(printed)).toBe(typed);
    expect(printed).toBe(
      `Rappel${NBSP}: la sortie «${NBSP}Au musée${NBSP}» est le 1er${NBSP}décembre à 13${NBSP}h${NBSP}35${NBSP}! Apportez 2,50${NBSP}$${NBSP}; nous comptons jusqu’à 1${NBSP}000${NBSP}?`,
    );
    // As typed without spaces, it stays so.
    expect(printedText('Bravo!', 'fr')).toBe('Bravo!');
    expect(printedText('Le 15 octobre, 3 heures de 10 h', 'fr')).toBe(
      `Le 15${NBSP}octobre, 3 heures de 10${NBSP}h`,
    );
  });

  it('English: dates and times kept whole', () => {
    expect(printedText('Thursday, October 15 at 1:35 p.m.: see you there!', 'en')).toBe(
      `Thursday, October${NBSP}15 at 1:35${NBSP}p.m.: see you there!`,
    );
  });

  it('text pasted from elsewhere: accents composed, ligature characters spelled out', () => {
    expect(printedText('été ﬁnal', 'fr')).toBe('été final');
  });
});
