/**
 * Evaluation set for « Créer avec l’IA » (library_item, DECISIONS D-072): ten requests as the
 * database builds them (labels and attente texts from the demo curriculum, ids made up), one per
 * kind of resource worth checking. All fictional; the only person is case 2's student, named in
 * the teacher's note, who must never reach the resource.
 *
 *   pnpm ai:eval --feature library_item --provider fake
 *   pnpm ai:eval --feature library_item --case quiz-5e --yes    # one real case, under $1
 */
import type { LibraryItemInput } from '../features/library-item';
import type { KnownPerson } from '../privacy';
import type { LibraryItemExpectations } from './checks';

export interface LibraryItemCase {
  id: string;
  title: string;
  /** As `app.library_item_ai_input` returns it (character names are added per request). */
  input: Omit<LibraryItemInput, 'characterNames'>;
  people?: KnownPerson[];
  expect: LibraryItemExpectations;
}

const FRA = 'fc77b6d1-3e15-4303-9ee1-1adb48730eac';
const MAT = 'ece67150-44d3-4e6e-b772-d9bde2165caf';
const SCI = '5c0a9e3e-8f59-4d5b-9d0a-3b0d9a6f1c21';
const EPS = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const ERE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** The demo board's four levels, most accessible first. */
export const EVAL_LEVELS = [
  {
    key: 'L1',
    languageLevelId: 'c46ae6a9-da0b-4bcb-ab38-a1761dd9786b',
    label: 'Débutant',
    description:
      'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.',
    mostAccessible: true,
  },
  {
    key: 'L2',
    languageLevelId: '71516dc0-c84c-473f-aa4a-14304a000924',
    label: 'Intermédiaire',
    description: 'Phrases simples et vocabulaire courant, quelques mots nouveaux expliqués.',
    mostAccessible: false,
  },
  {
    key: 'L3',
    languageLevelId: '0b7d3c5e-2a41-4f8e-9c6d-5e4f3a2b1c0d',
    label: 'Avancé',
    description: 'Texte du niveau scolaire attendu.',
    mostAccessible: false,
  },
  {
    key: 'L4',
    languageLevelId: '1c8e4d6f-3b52-4a9f-8d7e-6f5a4b3c2d1e',
    label: 'Enrichi',
    description: 'Vocabulaire plus riche et questions d’approfondissement.',
    mostAccessible: false,
  },
] as const;

const exp = (key: string, code: string, text: string, n: string) => ({
  key,
  expectationId: `20000000-0000-4000-8000-0000000${n}`,
  code,
  text,
});

const base: Pick<
  LibraryItemCase['input'],
  'strandLabel' | 'levels' | 'catholic' | 'subFriendly' | 'teacherNote'
> = {
  strandLabel: null,
  levels: [],
  catholic: null,
  subFriendly: false,
  teacherNote: '',
};

export const libraryItemCases: LibraryItemCase[] = [
  {
    id: 'lecture-3e',
    title: 'Texte de lecture, 3e année, idée principale, 4 niveaux',
    input: {
      ...base,
      itemType: 'reading_passage',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: FRA,
      subjectLabel: 'Français',
      strandLabel: 'Compréhension : comprendre et réagir à des textes',
      expectations: [
        exp(
          'E1',
          'C1.2',
          'Repérer l’idée principale et quelques détails importants d’un texte informatif.',
          '30c12',
        ),
      ],
      levels: [...EVAL_LEVELS],
      durationMinutes: 40,
      subFriendly: true,
      teacherNote: 'Un texte informatif sur un animal de l’Ontario.',
    },
    expect: { mostAccessibleShort: true, glossaryOnMostAccessible: 2 },
  },
  {
    id: 'fiche-ordonner-3e',
    title: 'Fiche d’exercices, 3e année, ordonner des nombres, note avec un prénom',
    input: {
      ...base,
      itemType: 'worksheet',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      strandLabel: 'Nombres',
      expectations: [
        exp('E1', 'B1.2', 'Comparer et ordonner des nombres naturels jusqu’à 1 000.', '30b12'),
      ],
      durationMinutes: 30,
      teacherNote: 'Pour Liam, des nombres simples. Des questions pour ordonner des nombres.',
    },
    people: [{ name: 'Liam', kind: 'student' }],
    expect: { maxNumber: 1000, absentNames: ['Liam'] },
  },
  {
    id: 'quiz-5e',
    title: 'Quiz, 5e année, comparer des fractions et des nombres décimaux',
    input: {
      ...base,
      itemType: 'quiz',
      gradeCodes: ['5'],
      gradeLabels: ['5e année'],
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      strandLabel: 'Nombres',
      expectations: [
        exp(
          'E1',
          'B1.6',
          'Comparer et ordonner des fractions et des nombres décimaux jusqu’aux centièmes.',
          '50b12',
        ),
      ],
      durationMinutes: 25,
    },
    expect: { minQuestionKinds: 3, autoGradable: true },
  },
  {
    id: 'experience-5e',
    title: 'Expérience, 5e année, forces internes, pour la suppléance',
    input: {
      ...base,
      itemType: 'experiment',
      gradeCodes: ['5'],
      gradeLabels: ['5e année'],
      subjectId: SCI,
      subjectLabel: 'Sciences et technologie',
      strandLabel: 'Structures et mécanismes',
      expectations: [
        exp(
          'E1',
          'D2.1',
          'Distinguer les forces internes (compression, tension, torsion, cisaillement) et externes.',
          '50d11',
        ),
      ],
      durationMinutes: 50,
      subFriendly: true,
    },
    expect: {
      safety: { allergyWords: ['sans latex', 'sans noix', 'sans arachides'], standard: true },
    },
  },
  {
    id: 'defi-stim-5e',
    title: 'Défi STIM, 5e année, résister aux forces',
    input: {
      ...base,
      itemType: 'stem_challenge',
      gradeCodes: ['5'],
      gradeLabels: ['5e année'],
      subjectId: SCI,
      subjectLabel: 'Sciences et technologie',
      strandLabel: 'Structures et mécanismes',
      expectations: [
        exp(
          'E1',
          'D2.2',
          'Expliquer comment la forme et les matériaux d’une structure l’aident à résister aux forces.',
          '50d12',
        ),
      ],
      durationMinutes: 60,
    },
    expect: { designStages: true, safety: { allergyWords: [], standard: false } },
  },
  {
    id: 'grille-3e',
    title: 'Grille d’évaluation, 3e année, écrire pour informer',
    input: {
      ...base,
      itemType: 'rubric',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: FRA,
      subjectLabel: 'Français',
      strandLabel: 'Composition : exprimer ses idées et créer des textes',
      expectations: [
        exp(
          'E1',
          'D1',
          'Planifier et rédiger de courts textes pour communiquer de l’information à un public donné.',
          '30d01',
        ),
      ],
      durationMinutes: 10,
    },
    expect: { rubric: true },
  },
  {
    id: 'pause-active-1re',
    title: 'Pause active, 1re et 2e année, sans attente, pour la suppléance',
    input: {
      ...base,
      itemType: 'brain_break',
      gradeCodes: ['1', '2'],
      gradeLabels: ['1re année', '2e année'],
      subjectId: EPS,
      subjectLabel: 'Éducation physique et santé',
      expectations: [],
      durationMinutes: 5,
      subFriendly: true,
    },
    expect: { maxSteps: 10, maxDuration: 5, noEquipment: true },
  },
  {
    id: 'reflexion-3e',
    title: 'Réflexion catholique, 3e année, « Prendre soin de la création »',
    input: {
      ...base,
      itemType: 'catholic_reflection',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: ERE,
      subjectLabel: 'Enseignement religieux',
      expectations: [],
      catholic: {
        key: 'R1',
        referenceId: '6ffed8e8-d54d-4ca1-95ad-92d6ac4793d8',
        type: 'reflection',
        title: 'Prendre soin de la création',
        text: 'Comment peux-tu prendre soin de la nature et des animaux autour de toi cette semaine?',
      },
      durationMinutes: 10,
    },
    expect: { faithMentions: ['création', 'nature'], maxQuotationWords: 25 },
  },
  {
    id: 'amorce-5e',
    title: 'Amorce culturelle, 5e année, la francophonie ontarienne, sans attente',
    input: {
      ...base,
      itemType: 'culture_hook',
      gradeCodes: ['5'],
      gradeLabels: ['5e année'],
      subjectId: FRA,
      subjectLabel: 'Français',
      expectations: [],
      durationMinutes: 15,
      teacherNote: 'Sur la francophonie ontarienne.',
    },
    expect: { factsToVerify: true },
  },
  {
    id: 'guide-familles-3e',
    title: 'Guide pour les familles, 3e année, les nombres jusqu’à 1 000',
    input: {
      ...base,
      itemType: 'parent_guide',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      strandLabel: 'Nombres',
      expectations: [
        exp(
          'E1',
          'B1',
          'Démontrer une compréhension des nombres naturels jusqu’à 1 000 et de leurs relations.',
          '30b01',
        ),
      ],
      durationMinutes: 10,
    },
    expect: { bilingual: true },
  },
];
