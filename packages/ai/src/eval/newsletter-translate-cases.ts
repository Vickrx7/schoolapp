/**
 * Evaluation set for « Traduire en anglais (IA) » (newsletter_translate, DECISIONS D-139): ten
 * messages as the database builds them (`app.newsletter_ai_input`, the app's own lines and the
 * teacher's typed paragraphs), one per kind of week worth checking: a full 3e week, an early
 * dismissal, a progress report going home, people the app knows (and one it does not, never
 * sent), numbers and money, an Advent prayer, a field trip, Franco-Ontarian school words, twenty
 * long paragraphs near the limits, and a paragraph already partly in English. All fictional.
 *
 *   pnpm ai:eval --feature newsletter_translate --provider fake
 *   pnpm ai:eval --feature newsletter_translate --case semaine-3e-complete --yes   # one real case
 */
import type {
  NewsletterTranslateInput,
  NewsletterTranslateItem,
  NewsletterTranslateSection,
} from '../features/newsletter-translate';
import type { KnownPerson } from '../privacy';
import type { NewsletterTranslationExpectations } from './checks';

export interface NewsletterTranslateCase {
  id: string;
  title: string;
  /** As `app.newsletter_ai_input` returns it (the preview's: every paragraph the rules allow). */
  input: NewsletterTranslateInput;
  people?: KnownPerson[];
  expect?: NewsletterTranslationExpectations;
}

/** The demo class's people the cases name (fictional). */
const PEOPLE: KnownPerson[] = [
  { name: 'Samuel', kind: 'student' },
  { name: 'Aïcha', kind: 'student' },
  { name: 'Léa', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
  { name: 'Marc Gagnon', kind: 'staff' },
];

let counter = 0;
/** A message as the database returns it: keys P1… in order, ids of eight letters or digits. */
function message(
  paragraphs: [NewsletterTranslateSection, string][],
  extra: Partial<NewsletterTranslateInput> = {},
): NewsletterTranslateInput {
  counter += 1;
  const items: NewsletterTranslateItem[] = paragraphs.map(([section, text], i) => ({
    key: `P${i + 1}`,
    itemId: `c${String(counter).padStart(2, '0')}p${String(i + 1).padStart(4, '0')}`,
    section,
    text,
  }));
  return {
    newsletterId: `00000000-0000-4000-8000-0000000001${String(counter).padStart(2, '0')}`,
    revision: 2,
    scope: 'missing',
    gradeLabels: ['3e année'],
    items,
    sendKeys: null,
    ...extra,
  };
}

/** Twenty long paragraphs (about 900 characters each), near the request's limits. */
function longWeek(): [NewsletterTranslateSection, string][] {
  const topics = [
    ['la lecture', 'les livres de la bibliothèque de classe', 'un résumé de trois phrases'],
    ['les fractions', 'des bandes de papier et des cubes', 'des demis, des tiers et des quarts'],
    ['les plantes', 'des graines de haricots dans des verres', 'la croissance chaque matin'],
    ['les communautés', 'une carte de l’Ontario', 'les services de notre quartier'],
    ['l’écriture', 'un carnet d’écrivain', 'une histoire avec un début, un milieu et une fin'],
  ] as const;
  const sections: NewsletterTranslateSection[] = ['thisWeek', 'nextWeek', 'reminders', 'atHome'];
  return Array.from({ length: 20 }, (_, i) => {
    const [topic, tool, goal] = topics[i % topics.length]!;
    const day = 10 + i;
    const text = [
      `Semaine ${i + 1} : en classe, nous avons travaillé ${topic} avec ${tool}.`,
      `Les élèves ont d’abord observé, puis ils ont discuté en équipes de quatre avant de présenter leurs idées au groupe.`,
      `Le ${day} novembre, nous ferons une activité de consolidation qui portera sur ${goal}; chaque élève aura besoin de son agenda et d’un crayon.`,
      `À la maison, vous pouvez demander à votre enfant de vous expliquer ce qu’il a appris, en utilisant les mots nouveaux de la semaine.`,
      `Prévoyez environ 15 minutes, trois soirs par semaine, dans un endroit calme.`,
      `Les travaux seront affichés dans le corridor jusqu’au ${day + 2} novembre; vous êtes les bienvenus pour venir les voir après l’école, de 15 h 15 à 15 h 45.`,
      `Merci de votre précieuse collaboration et de votre appui constant tout au long de cette étape.`,
    ].join(' ');
    return [sections[i % sections.length]!, text];
  });
}

export const newsletterTranslateCases: NewsletterTranslateCase[] = [
  {
    id: 'semaine-3e-complete',
    title: 'Une semaine complète de 3e année, préparée par l’application et complétée',
    people: PEOPLE,
    input: message([
      ['message', 'Bonjour chères familles,'],
      [
        'message',
        'Quelle belle semaine ! Les élèves ont adoré notre visite à la bibliothèque municipale.',
      ],
      [
        'thisWeek',
        'Mathématiques (unité « Les nombres jusqu’à 1 000 ») : « Compter par bonds de 10 », « Les centaines »',
      ],
      ['thisWeek', 'Français (unité « Lire pour le plaisir ») : « Les indices du texte »'],
      [
        'nextWeek',
        'Sciences et technologie : nous commencerons l’unité « Les structures solides et stables »',
      ],
      ['dates', 'vendredi 9 octobre : Journée pédagogique (pas d’école)'],
      ['dates', 'lundi 12 octobre : Action de grâce (pas d’école)'],
      ['dates', 'jeudi 8 octobre à 10 h : Messe de l’Action de grâce'],
      ['reminders', 'Merci de signer l’agenda chaque soir.'],
      [
        'atHome',
        'Comptez par bonds de 10 en montant l’escalier ou en mettant la table : commencez à 30, puis à 170.',
      ],
      [
        'faith',
        'Cette semaine, nous prions ensemble : « Seigneur, merci pour la nourriture que nous partageons et pour les personnes qui la préparent. »',
      ],
      ['closing', 'Bonne fin de semaine !'],
    ]),
  },
  {
    id: 'depart-hatif',
    title: 'Un départ hâtif à 13 h 35 et les rencontres parents-enseignants',
    input: message([
      ['dates', 'jeudi 19 novembre : départ hâtif à 13 h 35'],
      [
        'reminders',
        'Les rencontres parents-enseignants ont lieu le jeudi 19 novembre, de 15 h 30 à 19 h 30. Réservez votre rendez-vous de 10 minutes avant le 13 novembre.',
      ],
      ['dates', 'vendredi 20 novembre : Journée pédagogique (pas d’école)'],
    ]),
  },
  {
    id: 'bulletin-progres',
    title: 'La remise du bulletin de progrès',
    input: message([
      ['dates', 'jeudi 12 novembre : remise du bulletin de progrès'],
      [
        'reminders',
        'Le bulletin de progrès arrive à la maison dans le sac d’école. Signez et retournez le talon avant le 18 novembre.',
      ],
      [
        'message',
        'Le bulletin de progrès montre comment votre enfant commence l’année : ce n’est pas une note finale.',
      ],
    ]),
  },
  {
    id: 'marqueurs',
    title: 'Deux élèves et une collègue nommés; une bénévole que l’application ne connaît pas',
    people: PEOPLE,
    input: message([
      ['message', 'Bravo à Samuel et à Aïcha, qui ont lu leur poème devant toute l’école !'],
      ['message', 'Mme Tremblay et M. Gagnon remercient les familles pour les dons de livres.'],
      ['message', 'Merci à Mme Dupuis, qui a accompagné la sortie au verger.'],
      ['reminders', 'Léa sera notre responsable du jardin la semaine prochaine.'],
    ]),
    expect: {
      notSent: ['P3'],
      names: {
        P1: ['Samuel', 'Aïcha'],
        P2: ['Mme Tremblay', 'M. Gagnon'],
        P4: ['Léa'],
      },
    },
  },
  {
    id: 'nombres-argent',
    title: 'Des nombres et de l’argent : 1 000, 2,50 $, 15 $',
    input: message([
      [
        'reminders',
        'La vente de pizza revient le vendredi 23 octobre : 2,50 $ la pointe. Commandez avant le 21 octobre.',
      ],
      [
        'message',
        'Notre école a recueilli 1 000 denrées pour la banque alimentaire, et notre classe en a apporté 137 !',
      ],
      ['reminders', 'La sortie coûte 15 $ par élève; l’autobus part à 8 h 30.'],
    ]),
  },
  {
    id: 'priere-avent',
    title: 'Une prière pour l’Avent',
    input: message([
      ['dates', 'dimanche 29 novembre : premier dimanche de l’Avent'],
      [
        'faith',
        'Cette semaine, nous prions ensemble : « Dieu de lumière, en ce temps de l’Avent, ouvre nos cœurs à l’attente de Jésus. Aide-nous à préparer un chemin de paix dans notre famille et dans notre classe. Amen. »',
      ],
      ['faith', 'Notre valeur de la semaine : « l’espérance »'],
    ]),
  },
  {
    id: 'sortie-vetements',
    title: 'Une sortie éducative en plein air, avec les vêtements à prévoir',
    input: message([
      ['dates', 'mercredi 2 décembre : sortie éducative à la ferme (toute la journée)'],
      [
        'reminders',
        'Pour la sortie éducative, habillez votre enfant pour passer la journée dehors : habit de neige, tuque, mitaines et bottes. Prévoyez un dîner froid et deux collations.',
      ],
      [
        'reminders',
        'Le formulaire d’autorisation doit être signé et rapporté avant le vendredi 27 novembre.',
      ],
      ['reminders', 'Pour toute question, appelez le secrétariat au 613-555-0142.'],
    ]),
    expect: { notSent: ['P4'] },
  },
  {
    id: 'termes-franco-ontariens',
    title: 'Les mots de l’école franco-ontarienne',
    input: message([
      [
        'reminders',
        'N’oubliez pas les souliers d’intérieur et une collation santé pour la récréation.',
      ],
      [
        'message',
        'La direction d’école rappelle que la journée pédagogique du conseil scolaire est le vendredi 20 novembre.',
      ],
      [
        'reminders',
        'Les élèves de 3e année ont une entrée retardée le mardi 3 novembre : les classes commencent à 10 h 15.',
      ],
      ['dates', 'mercredi 10 février 2027 à 9 h 45 : Messe du mercredi des Cendres'],
    ]),
  },
  {
    id: 'vingt-paragraphes',
    title: 'Vingt longs paragraphes, près des limites',
    input: message(longWeek(), { scope: 'all' }),
  },
  {
    id: 'deja-en-anglais',
    title: 'Un paragraphe déjà en partie en anglais',
    input: message([
      [
        'reminders',
        'Le Terry Fox Run de l’école aura lieu le jeudi 24 septembre. Bring a water bottle and running shoes!',
      ],
      ['message', 'Thank you to all families for the warm welcome — merci beaucoup !'],
    ]),
  },
];
