/**
 * Sample content for every type, for the fake AI provider and for tests. `sampleVersion` and
 * `sampleKey` return the `ai` shape (flat questions and answers), like a real answer would;
 * `sampleCanonical` gives the canonical content and key. Every sample passes `final`, its key
 * validates, and its French follows the style rules. Characters take names from the prompt's
 * fictional pool, never a student's.
 */
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { normalizeAiVersion } from './ai';
import { mapQuestions, questionsOf } from './questions-of';
import type { AnswerEntry, AnswerKey, Question } from './questions';
import type { SafetyNotes } from './safety';
import type { ContentOf } from './schemas';
import { NBSP } from './style';

export interface SampleContext {
  /** The version title (`''`: the item's title). */
  title?: string;
  objective?: string;
}

const colon = (label: string, text: string) => `${label}${NBSP}: ${text}`;

// ---------------------------------------------------------------------------------------
// Questions and their answers
// ---------------------------------------------------------------------------------------

const Q = {
  compare: {
    id: 'mc1',
    kind: 'multiple_choice',
    prompt: 'Quel nombre est le plus grand?',
    hint: 'Regarde d’abord le chiffre des centaines.',
    points: 1,
    category: 'connaissance',
    choices: [
      { id: 'c2', text: '389' },
      { id: 'c1', text: '893' },
      { id: 'c3', text: '398' },
    ],
    multipleAnswers: false,
  },
  trueFalse: {
    id: 'tf1',
    kind: 'true_false',
    prompt: '450 est plus petit que 540.',
    hint: '',
    points: 1,
    category: 'connaissance',
  },
  matching: {
    id: 'ma1',
    kind: 'matching',
    prompt: 'Associe chaque décomposition au bon nombre.',
    hint: '',
    points: null,
    category: 'application',
    left: [
      { id: 'l1', text: '300 + 40 + 5' },
      { id: 'l2', text: '500 + 4' },
    ],
    right: [
      { id: 'r2', text: '504' },
      { id: 'r3', text: '540' },
      { id: 'r1', text: '345' },
    ],
  },
  ordering: {
    id: 'or1',
    kind: 'ordering',
    prompt: 'Place ces nombres du plus petit au plus grand.',
    hint: '',
    points: 1,
    category: 'habiletes',
    items: [
      { id: 'i3', text: '710' },
      { id: 'i1', text: '170' },
      { id: 'i2', text: '701' },
    ],
  },
  explain: {
    id: 'sa1',
    kind: 'short_answer',
    prompt: 'Explique comment tu sais que 893 est plus grand que 389.',
    hint: '',
    points: 2,
    category: 'communication',
    lines: 3,
  },
  mainIdea: {
    id: 'sa2',
    kind: 'short_answer',
    prompt: 'Quelle est l’idée principale du texte?',
    hint: 'Relis la première phrase de chaque paragraphe.',
    points: null,
    category: 'connaissance',
    lines: 3,
  },
  beaverTrue: {
    id: 'tf2',
    kind: 'true_false',
    prompt: 'Le castor construit sa hutte avec des branches et de la boue.',
    hint: '',
    points: null,
    category: null,
  },
  practice: {
    id: 'p1',
    kind: 'short_answer',
    prompt: 'Compare 612 et 621. Quel nombre est le plus grand?',
    hint: '',
    points: null,
    category: null,
    lines: 2,
  },
  sponge: {
    id: 'sa3',
    kind: 'short_answer',
    prompt: 'Qu’est-ce qui est arrivé à l’éponge quand tu as appuyé dessus?',
    hint: '',
    points: null,
    category: 'habiletes',
    lines: 3,
  },
  structure: {
    id: 'sa4',
    kind: 'short_answer',
    prompt: 'Quelle partie de ton pont était la plus solide? Pourquoi?',
    hint: '',
    points: null,
    category: 'habiletes',
    lines: 3,
  },
  beaverRiddle: {
    id: 'ri1',
    kind: 'short_answer',
    prompt: 'Je vis en Ontario. Je construis des barrages avec des branches. Qui suis-je?',
    hint: 'J’ai de grandes dents orange.',
    points: null,
    category: null,
    lines: 1,
  },
  loonRiddle: {
    id: 'ri2',
    kind: 'short_answer',
    prompt: 'Je suis un oiseau noir et blanc. Je chante sur les lacs le soir. Qui suis-je?',
    hint: '',
    points: null,
    category: null,
    lines: 1,
  },
} satisfies Record<string, Question>;

const ENTRIES: Record<string, AnswerEntry> = {
  mc1: {
    questionId: 'mc1',
    kind: 'multiple_choice',
    correctChoiceIds: ['c1'],
    explanation: '893 a 8 centaines; 389 et 398 en ont seulement 3.',
  },
  tf1: { questionId: 'tf1', kind: 'true_false', correct: true, explanation: '' },
  ma1: {
    questionId: 'ma1',
    kind: 'matching',
    pairs: [
      { leftId: 'l1', rightId: 'r1' },
      { leftId: 'l2', rightId: 'r2' },
    ],
    explanation: '',
  },
  or1: { questionId: 'or1', kind: 'ordering', orderedIds: ['i1', 'i2', 'i3'], explanation: '' },
  sa1: {
    questionId: 'sa1',
    kind: 'short_answer',
    sampleAnswer: 'Le chiffre des centaines de 893 est 8, et celui de 389 est 3.',
    acceptableAnswers: [],
    explanation: '',
  },
  sa2: {
    questionId: 'sa2',
    kind: 'short_answer',
    sampleAnswer: 'Le castor transforme la rivière pour se protéger et se nourrir.',
    acceptableAnswers: [],
    explanation: '',
  },
  tf2: { questionId: 'tf2', kind: 'true_false', correct: true, explanation: '' },
  p1: {
    questionId: 'p1',
    kind: 'short_answer',
    sampleAnswer: '621 est plus grand, car il a 2 dizaines et 612 en a seulement 1.',
    acceptableAnswers: ['621'],
    explanation: '',
  },
  sa3: {
    questionId: 'sa3',
    kind: 'short_answer',
    sampleAnswer: 'L’éponge s’est écrasée, puis elle a repris sa forme.',
    acceptableAnswers: [],
    explanation: '',
  },
  sa4: {
    questionId: 'sa4',
    kind: 'short_answer',
    sampleAnswer: 'Le tablier plié en accordéon, parce que les plis le rendent plus rigide.',
    acceptableAnswers: [],
    explanation: '',
  },
  ri1: {
    questionId: 'ri1',
    kind: 'short_answer',
    sampleAnswer: 'Le castor',
    acceptableAnswers: ['le castor', 'castor', 'un castor'],
    explanation: '',
  },
  ri2: {
    questionId: 'ri2',
    kind: 'short_answer',
    sampleAnswer: 'Le huard',
    acceptableAnswers: ['le huard', 'huard', 'un huard'],
    explanation: '',
  },
};

// ---------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------

const BEAVER_TEXT = [
  'Le castor est le plus grand rongeur du Canada. Il vit près des rivières et des lacs de l’Ontario.',
  'Avec ses dents solides, le castor coupe des arbres. Il utilise les branches et la boue pour construire un barrage. L’eau monte derrière le barrage et forme un étang.',
  'Au milieu de l’étang, le castor construit sa hutte. L’entrée est sous l’eau, ce qui le protège des loups et des renards.',
].join('\n\n');

type Common = { title: string; objective: string; teacherNote: string };

const step = (minutes: number | null, instruction: string, say = '') => ({
  minutes,
  instruction,
  say,
});

function samples(common: Common): { [T in LibraryItemType]: ContentOf<T> } {
  return {
    lesson_plan: {
      ...common,
      successCriteria: ['Je nomme le sujet du texte.', 'Je trouve la phrase qui dit l’essentiel.'],
      opening: [
        step(
          5,
          'Présenter l’intention d’apprentissage et montrer le titre du texte.',
          'Aujourd’hui, nous cherchons ce qui est le plus important dans un texte.',
        ),
      ],
      development: [
        step(10, 'Lire le texte à voix haute pendant que les élèves suivent.'),
        step(
          10,
          'En équipes de deux, souligner la phrase la plus importante de chaque paragraphe.',
        ),
      ],
      closing: [step(5, 'Mettre en commun les phrases choisies et formuler l’idée principale.')],
      differentiation: 'Offrir le texte avec les mots difficiles déjà expliqués.',
      assessment: 'Observer les phrases soulignées et noter qui a besoin d’un retour.',
      subNotes: 'Le texte est dans le bac bleu. Les équipes sont affichées au tableau.',
    },
    anchor_chart: {
      ...common,
      heading: 'Comment trouver l’idée principale',
      sections: [
        {
          title: 'Je lis',
          points: ['Je lis le titre.', 'Je lis chaque paragraphe en entier.'],
          example: 'Le titre annonce le sujet.',
        },
        {
          title: 'Je cherche',
          points: ['Je me demande de quoi parle surtout le texte.'],
          example: '',
        },
      ],
      visualIdeas: ['Une loupe à côté de chaque étape.'],
    },
    worked_example: {
      ...common,
      problem: 'Compare 478 et 487. Quel nombre est le plus grand?',
      steps: [
        { explanation: 'Je compare les centaines.', work: '4 centaines et 4 centaines' },
        { explanation: 'Les centaines sont égales, alors je compare les dizaines.', work: '7 < 8' },
      ],
      answer: '487 est plus grand que 478.',
      practice: [Q.practice],
    },
    teacher_guide: {
      ...common,
      bigIdea: 'La valeur d’un chiffre dépend de sa position dans le nombre.',
      background:
        'Les élèves de 3e année comparent des nombres jusqu’à 1 000. Plusieurs regardent le premier chiffre sans tenir compte du nombre de chiffres.',
      keyVocabulary: [{ term: 'centaine', definition: 'Un groupe de 100.' }],
      misconceptions: [
        {
          misconception: 'Un nombre qui contient un 9 est toujours plus grand.',
          response: 'Comparer 190 et 801 avec du matériel de base dix.',
        },
      ],
      teachingTips: ['Utiliser un tableau de valeur de position.'],
      lookFors: ['L’élève compare d’abord les centaines.'],
    },
    worksheet: {
      ...common,
      instructions: 'Lis chaque question. Réponds dans l’espace prévu.',
      text: '',
      glossary: [
        { term: 'comparer', definition: 'Trouver ce qui est pareil et ce qui est différent.' },
      ],
      questions: [Q.compare, Q.ordering, Q.explain],
      visualSupports: ['Un tableau de valeur de position.'],
    },
    learning_centre: {
      ...common,
      setup: 'Placer les cartes-nombres et les jetons dans un bac.',
      groupSize: '2 à 4 élèves',
      studentSteps: [
        'Pige deux cartes.',
        'Forme le plus grand nombre possible.',
        'Compare avec ton équipe.',
      ],
      extension: 'Forme aussi le plus petit nombre possible.',
      cleanup: 'Remets les cartes dans le bac.',
    },
    reading_passage: {
      ...common,
      text: BEAVER_TEXT,
      glossary: [
        { term: 'rongeur', definition: 'Un animal qui a de grandes dents pour ronger.' },
        { term: 'hutte', definition: '' },
      ],
      questions: [Q.mainIdea, Q.beaverTrue],
      visualSupports: ['Une photo de barrage de castor.'],
    },
    vocabulary_bank: {
      ...common,
      theme: 'Les animaux de la forêt',
      words: [
        {
          term: 'castor',
          definition: 'Rongeur qui construit des barrages.',
          example: 'Le castor coupe un arbre.',
          wordClass: 'nom',
          gender: 'm',
        },
        {
          term: 'ronger',
          definition: 'Couper en petits morceaux avec les dents.',
          example: '',
          wordClass: 'verbe',
          gender: null,
        },
      ],
      activityIdeas: ['Mimer un mot et faire deviner la classe.'],
    },
    exit_ticket: {
      ...common,
      prompt: 'Avant de partir, montre ce que tu as appris.',
      questions: [Q.compare, Q.explain],
    },
    experiment: {
      ...common,
      researchQuestion: 'Qu’arrive-t-il à une éponge quand on appuie dessus?',
      hypothesisPrompt: 'Je pense que l’éponge va…',
      steps: [
        'Place l’éponge sur la table.',
        'Appuie dessus avec ta main pendant cinq secondes.',
        'Retire ta main et observe.',
      ],
      observationTable: { columns: ['Ce que je fais', 'Ce que j’observe'], rows: 3 },
      conclusionQuestions: [Q.sponge],
      communication: 'Présente ton observation à une autre équipe.',
    },
    stem_challenge: {
      ...common,
      challenge: 'Construis un pont de papier qui supporte le plus de jetons possible.',
      constraints: ['Deux feuilles de papier seulement.', 'Du ruban adhésif pour les appuis.'],
      criteria: ['Le pont franchit un espace de 20 cm.', 'Le pont supporte au moins 20 jetons.'],
      designStages: [
        { stage: 'definir', prompt: 'Explique le défi dans tes mots.' },
        { stage: 'construire', prompt: 'Construis ton pont selon ton plan.' },
        { stage: 'tester', prompt: 'Ajoute les jetons un à la fois.' },
      ],
      reflectionQuestions: [Q.structure],
    },
    project: {
      ...common,
      drivingQuestion: 'Comment un animal de l’Ontario s’adapte-t-il aux saisons?',
      overview: 'Les élèves choisissent un animal, font une recherche et présentent une affiche.',
      milestones: [
        {
          title: 'Choisir',
          description: 'Choisir un animal et noter trois questions.',
          sessions: 1,
        },
        {
          title: 'Chercher',
          description: 'Trouver des réponses dans des livres de la classe.',
          sessions: 3,
        },
      ],
      deliverables: ['Une affiche avec un titre et trois faits.'],
      successCriteria: ['Mes faits répondent à mes questions.'],
    },
    outdoor_activity: {
      ...common,
      location: 'La cour d’école, près du terrain de soccer',
      setup: 'Cacher vingt cartes-nombres dans la cour.',
      steps: [
        'Trouve trois cartes.',
        'Place-les en ordre croissant.',
        'Montre ton ordre à ton équipe.',
      ],
      safetyReminders: ['Reste dans la zone délimitée par les cônes.'],
      weatherAlternative: 'Cacher les cartes dans le gymnase.',
    },
    quiz: {
      ...common,
      instructions: 'Réponds à chaque question.',
      questions: [Q.compare, Q.trueFalse, Q.matching, Q.ordering, Q.explain],
    },
    unit_test: {
      ...common,
      instructions: 'Lis bien chaque partie avant de répondre.',
      sections: [
        { title: colon('Partie A', 'Comparer'), questions: [Q.compare, Q.trueFalse] },
        { title: colon('Partie B', 'Expliquer'), questions: [Q.explain] },
      ],
    },
    diagnostic: {
      ...common,
      purpose: 'Savoir ce que les élèves comprennent déjà de la valeur de position.',
      questions: [Q.compare, Q.explain],
      interpretation: [
        {
          signal: 'Choisit 389 ou 398.',
          nextStep: 'Revoir les centaines avec du matériel de base dix.',
        },
      ],
    },
    rubric: {
      ...common,
      task: 'Écrire une fiche informative sur un animal.',
      criteria: [
        {
          category: 'connaissance',
          criterion: 'Connaissance du sujet',
          levels: {
            level1: 'Démontre une connaissance limitée du sujet.',
            level2: 'Démontre une connaissance partielle du sujet.',
            level3: 'Démontre une connaissance générale du sujet.',
            level4: 'Démontre une connaissance approfondie du sujet.',
          },
        },
        {
          category: 'habiletes',
          criterion: 'Organisation des idées',
          levels: {
            level1: 'Organise ses idées avec une efficacité limitée.',
            level2: 'Organise ses idées avec une certaine efficacité.',
            level3: 'Organise ses idées avec efficacité.',
            level4: 'Organise ses idées avec beaucoup d’efficacité.',
          },
        },
        {
          category: 'communication',
          criterion: 'Clarté du message',
          levels: {
            level1: 'Communique l’information avec une efficacité limitée.',
            level2: 'Communique l’information avec une certaine efficacité.',
            level3: 'Communique l’information avec efficacité.',
            level4: 'Communique l’information avec beaucoup d’efficacité.',
          },
        },
        {
          category: 'application',
          criterion: 'Conventions linguistiques',
          levels: {
            level1: 'Applique les conventions avec une efficacité limitée.',
            level2: 'Applique les conventions avec une certaine efficacité.',
            level3: 'Applique les conventions avec efficacité.',
            level4: 'Applique les conventions avec beaucoup d’efficacité.',
          },
        },
      ],
    },
    report_comments: {
      ...common,
      scope: 'subject',
      period: 'term',
      entries: [
        {
          kind: 'strength',
          skill: null,
          level: 3,
          progress: null,
          rating: null,
          category: 'habiletes',
          expectationCodes: ['B1.2'],
          neutral: '{prénom} compare et ordonne des nombres jusqu’à 1 000 avec efficacité.',
          feminine: '',
          masculine: '',
        },
        {
          kind: 'next_step',
          skill: null,
          level: 2,
          progress: null,
          rating: null,
          category: null,
          expectationCodes: ['B1.2'],
          neutral:
            'Prochaine étape pour {prénom} : vérifier le chiffre des centaines avant de comparer deux nombres.',
          feminine: '',
          masculine: '',
        },
        {
          kind: 'general',
          skill: null,
          level: null,
          progress: null,
          rating: null,
          category: null,
          expectationCodes: [],
          neutral: 'Les progrès de {prénom} en mathématiques sont réguliers.',
          feminine: '',
          masculine: '',
        },
      ],
    },
    game: {
      ...common,
      grouping: 'En équipes de deux',
      setup: 'Préparer un paquet de cartes-nombres par équipe.',
      rules: ['Chaque personne retourne une carte.', 'Le plus grand nombre gagne les deux cartes.'],
      howToWin: 'Avoir le plus de cartes à la fin.',
      variations: ['Le plus petit nombre gagne.'],
      questions: [Q.trueFalse],
    },
    brain_break: {
      ...common,
      space: 'desk',
      steps: ['Lève les bras.', 'Touche tes épaules.', 'Respire lentement trois fois.'],
      calmVariant: 'Faire les gestes très lentement, en silence.',
    },
    song: {
      ...common,
      tune: 'Frère Jacques',
      verses: [
        {
          label: 'Couplet 1',
          lines: [
            'Cent, deux cents,',
            'Trois cents, quatre cents,',
            'On compte par cent,',
            'On compte par cent.',
          ],
        },
      ],
      gestures: ['Taper des mains à chaque centaine.'],
    },
    riddle: {
      ...common,
      riddles: [Q.beaverRiddle, Q.loonRiddle],
    },
    weekly_challenge: {
      ...common,
      challenge: 'Avec les chiffres 3, 5 et 8, forme tous les nombres possibles de trois chiffres.',
      days: [
        { label: 'Lundi', task: 'Trouve deux nombres.' },
        { label: 'Mercredi', task: 'Place tes nombres en ordre.' },
      ],
      hints: ['Commence par le 3 à la position des centaines.'],
      extension: 'Et avec quatre chiffres?',
    },
    catholic_reflection: {
      ...common,
      theme: 'Prendre soin de la création',
      scriptureReference: 'Genèse 1, 31',
      reflection:
        'La nature est un cadeau. Chaque jour, nous pouvons en prendre soin par de petits gestes.',
      questions: ['Quel geste peux-tu faire pour la nature cette semaine?'],
      prayer:
        'Seigneur, merci pour la nature qui nous entoure.\nAide-nous à en prendre soin. Amen.',
      action: 'Ramasser les déchets de la cour pendant la récréation.',
    },
    culture_hook: {
      ...common,
      hook: 'Connais-tu le drapeau vert et blanc des francophones de l’Ontario?',
      context: 'Le drapeau franco-ontarien montre une fleur de lys et un trille.',
      discussionQuestions: ['Où as-tu déjà vu ce drapeau?'],
      activity: 'Dessine un symbole qui représente ta communauté.',
      factsToVerify: ['L’année où le drapeau a été hissé pour la première fois.'],
    },
    parent_guide: {
      ...common,
      fr: {
        intro: 'Ce mois-ci, votre enfant apprend à comparer des nombres jusqu’à 1 000.',
        learning: ['Comparer deux nombres.', 'Placer des nombres en ordre.'],
        atHome: ['Comparez les prix à l’épicerie.'],
        words: [{ term: 'centaine', definition: 'Un groupe de 100.' }],
      },
      en: {
        intro: 'This month, your child is learning to compare numbers up to 1,000.',
        learning: ['Compare two numbers.', 'Put numbers in order.'],
        atHome: ['Compare prices at the grocery store.'],
        words: [{ term: 'centaine', definition: 'A group of 100 (hundred).' }],
      },
    },
  };
}

const SOLUTIONS: Partial<Record<LibraryItemType, string>> = {
  experiment: colon(
    'L’éponge se comprime sous la main, puis reprend sa forme',
    'c’est la compression.',
  ),
  weekly_challenge: 'Les six nombres sont 358, 385, 538, 583, 835 et 853.',
  stem_challenge: 'Un tablier plié en accordéon supporte plus de jetons qu’un tablier plat.',
};

// ---------------------------------------------------------------------------------------
// The ai shape
// ---------------------------------------------------------------------------------------

function flatQuestion(q: Record<string, unknown>): Record<string, unknown> {
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    hint: q.hint,
    points: q.points ?? null,
    category: q.category ?? null,
    choices: q.choices ?? null,
    multipleAnswers: q.multipleAnswers ?? null,
    left: q.left ?? null,
    right: q.right ?? null,
    items: q.items ?? null,
    lines: q.lines ?? null,
  };
}

function flatEntry(e: AnswerEntry): Record<string, unknown> {
  const x = e as unknown as Partial<Record<string, unknown>>;
  return {
    questionId: e.questionId,
    kind: e.kind,
    correctChoiceIds: x.correctChoiceIds ?? null,
    correct: x.correct ?? null,
    pairs: x.pairs ?? null,
    orderedIds: x.orderedIds ?? null,
    sampleAnswer: x.sampleAnswer ?? null,
    acceptableAnswers: x.acceptableAnswers ?? null,
    explanation: e.explanation,
  };
}

const clone = <T>(value: T): T => structuredClone(value);

/** A complete version of a type in the `ai` shape (flat questions). */
export function sampleVersion(
  type: LibraryItemType,
  ctx: SampleContext = {},
): Record<string, unknown> {
  const common: Common = {
    title: ctx.title ?? '',
    objective: ctx.objective ?? 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
    teacherNote: 'Prévoir du temps pour que chaque élève explique sa démarche.',
  };
  const content = clone(samples(common)[type]) as unknown as Record<string, unknown>;
  return mapQuestions(type, content, flatQuestion);
}

/** An entry for a question the samples don't know: the first choice, the display order… */
function fallbackEntry(q: Record<string, unknown>): AnswerEntry {
  const id = String(q.id);
  const ids = (value: unknown) =>
    Array.isArray(value) ? value.map((o) => String((o as { id?: unknown }).id)) : [];
  switch (q.kind) {
    case 'multiple_choice':
      return {
        questionId: id,
        kind: 'multiple_choice',
        correctChoiceIds: ids(q.choices).slice(0, 1),
        explanation: '',
      };
    case 'true_false':
      return { questionId: id, kind: 'true_false', correct: true, explanation: '' };
    case 'matching': {
      const right = ids(q.right);
      return {
        questionId: id,
        kind: 'matching',
        pairs: ids(q.left).map((leftId, i) => ({ leftId, rightId: right[i] ?? '' })),
        explanation: '',
      };
    }
    case 'ordering':
      return {
        questionId: id,
        kind: 'ordering',
        orderedIds: ids(q.items).reverse(),
        explanation: '',
      };
    default:
      return {
        questionId: id,
        kind: 'short_answer',
        sampleAnswer: 'Une réponse complète qui reprend les mots de la question.',
        acceptableAnswers: [],
        explanation: '',
      };
  }
}

/** The key of a sample content (either shape), in the `ai` shape; null when the type has none. */
export function sampleKey(type: LibraryItemType, content: unknown): Record<string, unknown> | null {
  if (!TYPE_INFO[type].mayHaveQuestions) return null;
  const questions = questionsOf(type, content);
  const solution = SOLUTIONS[type] ?? '';
  if (!questions.length && !solution && !TYPE_INFO[type].keyed) return null;
  return {
    answers: questions.map(({ question }) =>
      flatEntry(
        ENTRIES[question.id] ?? fallbackEntry(question as unknown as Record<string, unknown>),
      ),
    ),
    solution,
  };
}

/** One copy of the base per requested level key (`L1`…), in the `ai` shape. */
export function sampleLevels(
  type: LibraryItemType,
  base: Record<string, unknown>,
  keys: readonly string[],
): {
  level: string;
  content: Record<string, unknown>;
  answerKey: Record<string, unknown> | null;
}[] {
  return keys.map((level) => ({
    level,
    content: clone(base),
    answerKey: sampleKey(type, base),
  }));
}

/** Safety notes that pass `final`, for a sub-friendly experiment. */
export function sampleSafetyNotes(): SafetyNotes {
  return {
    ageSuitability: 'Convient aux élèves de 8 à 11 ans.',
    allergyAwareMaterials: 'Éponges synthétiques et élastiques sans latex; aucun aliment.',
    supervision: 'standard',
    hazards: ['Un élastique peut claquer; le tenir loin du visage.'],
    notes: '',
  };
}

/** The canonical content and key of a sample. */
export function sampleCanonical<T extends LibraryItemType>(
  type: T,
  ctx: SampleContext = {},
): { content: ContentOf<T>; answerKey: AnswerKey | null } {
  const content = sampleVersion(type, ctx);
  return normalizeAiVersion(type, { content, answerKey: sampleKey(type, content) });
}
