/**
 * A week's « Info-parents » message for the PDF's tests (newsletter-model.test.ts,
 * render.test.ts): the first draft the app writes for the demo's 3e année (lessons, next week, a
 * PA day, an assembly, a report card going home, the demo family guide's tips, a prayer), from the
 * real message files, then edited as a teacher would (a paragraph of her own with her English, an
 * app line edited so its English is out of date, a reminder without English).
 */
import {
  buildNewsletterDraft,
  typedItem,
  withTeacherEnglish,
  type NewsletterContent,
  type NewsletterFacts,
  type NewsletterItem,
} from '@lynx/domain';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { newsletterPhrasePair, type MessageCatalog } from '../newsletter/phrases';
import {
  buildNewsletterPdfModel,
  newsletterPdfLabels,
  type NewsletterPdfInput,
} from './newsletter-model';

export const NEWSLETTER_LABELS = {
  fr: newsletterPdfLabels('fr-CA', fr),
  en: newsletterPdfLabels('en-CA', en as MessageCatalog),
};

const MATH = { fr: 'Mathématiques', en: 'Mathematics' };
/** The ids a paragraph's source keeps (never printed). */
const ref = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FRENCH = { fr: 'Français', en: 'French' };

export const NEWSLETTER_FACTS: NewsletterFacts = {
  weekOf: '2026-10-05',
  thisWeek: [
    {
      subjectId: 'mat',
      subject: MATH,
      unitId: ref(1),
      unitTitle: 'Les nombres jusqu’à 1 000',
      lessons: [
        { id: ref(4), title: 'Lire et écrire des nombres jusqu’à 1 000' },
        { id: ref(5), title: 'Comparer des nombres' },
      ],
    },
    {
      subjectId: 'fra',
      subject: FRENCH,
      unitId: ref(2),
      unitTitle: 'Les animaux du Canada',
      lessons: [{ id: ref(6), title: 'Le castor, bâtisseur de barrages' }],
    },
  ],
  nextWeek: [
    {
      subjectId: 'mat',
      subject: MATH,
      unitId: ref(1),
      unitTitle: 'Les nombres jusqu’à 1 000',
      lessons: [{ id: ref(7), title: 'Arrondir à la dizaine près' }],
    },
  ],
  nextLessonsOnly: false,
  unitStarts: [
    {
      subjectId: 'mat',
      subject: MATH,
      unitId: ref(3),
      title: 'L’addition et la soustraction jusqu’à 1 000',
      startsOn: '2026-10-13',
    },
  ],
  dates: [
    {
      kind: 'dayOff',
      id: ref(8),
      from: '2026-10-09',
      to: '2026-10-09',
      title: 'Journée pédagogique',
      type: 'pa_day',
    },
    {
      kind: 'dayOff',
      id: ref(9),
      from: '2026-10-12',
      to: '2026-10-12',
      title: 'Action de grâce',
      type: 'holiday',
    },
    {
      kind: 'event',
      id: ref(10),
      from: '2026-10-13',
      to: '2026-10-13',
      time: '13:15',
      title: 'Spectacle de la chorale',
      type: 'assembly',
    },
    { kind: 'report', from: '2026-10-22', period: 'progress' },
  ],
  guides: [
    {
      id: ref(11),
      title: 'Les nombres jusqu’à 1 000 à la maison',
      tips: [
        {
          fr: 'chercher des nombres autour de vous (adresses, prix, pages d’un livre) et demander à votre enfant de les lire à voix haute',
          en: 'look for numbers around you (addresses, prices, page numbers) and ask your child to read them aloud',
        },
        {
          fr: 'jouer au « nombre mystère » : pensez à un nombre entre 1 et 1 000; votre enfant pose des questions comme « Est-il plus grand que 500? » pour le trouver',
          en: 'play “Mystery Number”: think of a number between 1 and 1,000; your child asks questions such as “Is it greater than 500?” to find it',
        },
        {
          fr: 'compter par 10 ou par 100 en marchant, en montant l’escalier ou en attendant l’autobus',
          en: 'count by 10s or by 100s while walking, climbing stairs or waiting for the bus',
        },
      ],
    },
  ],
  faith: {
    id: ref(12),
    boardId: null,
    type: 'prayer',
    title: 'Prière avant le travail',
    textFr:
      'Seigneur, aide-moi à bien écouter, à faire de mon mieux et à aider mes amis aujourd’hui. Amen.',
    textEn: 'Lord, help me to listen well, to do my best and to help my friends today. Amen.',
    gradeMin: -1,
    gradeMax: 6,
    liturgicalSeason: null,
    tags: [],
  },
};

/** The app's first draft for the week. */
export function newsletterDraft(): NewsletterContent {
  let n = 0;
  return buildNewsletterDraft(
    NEWSLETTER_FACTS,
    newsletterPhrasePair({ fr, en: en as MessageCatalog }),
    { signature: 'Mme Tremblay', faith: true, guides: true },
    () => `item${String(n++).padStart(4, '0')}`,
  );
}

const section = (content: NewsletterContent, key: string) =>
  content.sections.find((s) => s.key === key)!;

/**
 * The draft as the teacher left it: her news with her English after the greeting; the first
 * lesson line edited (its English is now out of date); a reminder without English.
 */
export function editedNewsletter(): NewsletterContent {
  const content = newsletterDraft();
  const news: NewsletterItem = withTeacherEnglish(
    typedItem(
      'typed001',
      'Quelle belle semaine! Nous avons visité la bibliothèque municipale et chaque élève a choisi un livre sur les animaux du Canada.',
    ),
    'What a great week! We visited the public library and every student chose a book about Canada’s animals.',
  );
  section(content, 'message').items.splice(1, 0, news);
  const lessons = section(content, 'thisWeek').items;
  lessons[0] = { ...lessons[0]!, fr: `${lessons[0]!.fr} Bravo à toute la classe!` };
  section(content, 'reminders').items.push(
    typedItem(
      'typed002',
      'Merci d’apporter une boîte de mouchoirs pour la classe d’ici le vendredi 16 octobre.',
    ),
  );
  return content;
}

export function newsletterInput(overrides: Partial<NewsletterPdfInput> = {}): NewsletterPdfInput {
  return {
    content: editedNewsletter(),
    school: 'École élémentaire catholique Saint-Exemple',
    className: '3e année – Mme Tremblay',
    weekOf: '2026-10-05',
    lang: 'both',
    ...overrides,
  };
}

export const newsletterModel = (overrides: Partial<NewsletterPdfInput> = {}) =>
  buildNewsletterPdfModel(newsletterInput(overrides), NEWSLETTER_LABELS);
