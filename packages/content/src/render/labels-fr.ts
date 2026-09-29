/**
 * French labels printed on documents. Content is French, so documents are French whatever the
 * interface language (D-046); only the English half of a family guide uses `FAMILY_LABELS['en-CA']`.
 * Screen labels live in the message files; `libraryCommon.types` equals `TYPE_INFO.labelFr`.
 */
import type { QuestionKind, AchievementCategory } from '../questions';
import type { Supervision } from '../safety';
import { NBSP } from '../style';

/** « Label : » with the non-breaking space. */
export const labelled = (label: string, text: string) => `${label}${NBSP}: ${text}`;

export const DOC_LABELS_FR = {
  objective: 'Intention d’apprentissage',
  /** The name line of a sheet students fill in: never a level (D-042). */
  name: 'Nom',
  date: 'Date',
  teacherNote: 'Notes pédagogiques',
  successCriteria: 'Critères de réussite',
  differentiation: 'Différenciation',
  assessment: 'Évaluation',
  subNotes: 'Notes pour la suppléance',
  say: 'À dire',
  grades: 'Années d’études',
  subject: 'Matière',
  duration: 'Durée',
  minutes: (n: number) => `${n}${NBSP}min`,
  materials: 'Matériel',
  expectations: 'Attentes visées',
  toVerify: 'à vérifier',
  safety: 'Sécurité',
  ageSuitability: 'Âge',
  allergyAwareMaterials: 'Matériel et allergies',
  supervision: 'Supervision',
  hazards: 'Dangers possibles',
  safetyNotes: 'Remarques',
  faith: 'Lien avec la foi',
  faithReference: 'Référence',
  glossary: 'Glossaire',
  questions: 'Questions',
  hint: 'Indice',
  points: (n: number) => (n === 1 ? '1 point' : `${n} points`),
  trueLabel: 'Vrai',
  falseLabel: 'Faux',
  matchingHelp: 'Associe chaque élément de gauche à un élément de droite.',
  orderingHelp: 'Numérote les éléments dans le bon ordre.',
  severalAnswers: 'Plusieurs réponses possibles.',
  answerKey: 'Corrigé',
  answerKeyVersion: (n: number) => `Corrigé — version ${n}`,
  sampleAnswer: 'Exemple de réponse',
  acceptableAnswers: 'Réponses acceptées',
  manualGrading: 'Correction manuelle',
  missingAnswer: 'Réponse à ajouter',
  explanation: 'Explication',
  expectedOrder: 'Ordre attendu',
  solution: 'Solution',
  expectedResults: 'Résultats attendus',
  // Type fields.
  visualIdeas: 'Idées d’appuis visuels',
  example: 'Exemple',
  problem: 'Problème',
  solutionSteps: 'Démarche',
  answer: 'Réponse',
  practice: 'À ton tour',
  bigIdea: 'Idée maîtresse',
  background: 'Ce qu’il faut savoir',
  keyVocabulary: 'Vocabulaire clé',
  misconceptions: 'Idées fausses fréquentes',
  misconception: 'Idée fausse',
  response: 'Comment réagir',
  teachingTips: 'Conseils pour enseigner',
  lookFors: 'Ce qu’on observe',
  instructions: 'Consignes',
  visualSupports: 'Appuis visuels suggérés',
  setup: 'Préparation',
  groupSize: 'Nombre d’élèves',
  studentSteps: 'Étapes',
  extension: 'Pour aller plus loin',
  cleanup: 'Rangement',
  activityIdeas: 'Idées d’activités',
  word: 'Mot',
  wordClass: 'Classe',
  definition: 'Définition',
  researchQuestion: 'Question de recherche',
  hypothesis: 'Mon hypothèse',
  procedure: 'Démarche',
  observations: 'Mes observations',
  conclusion: 'Conclusion',
  communication: 'Communiquer mes résultats',
  challenge: 'Le défi',
  constraints: 'Contraintes',
  criteria: 'Critères de réussite',
  designProcess: 'Processus de design',
  reflection: 'Réflexion',
  drivingQuestion: 'Question directrice',
  overview: 'Aperçu',
  milestones: 'Étapes du projet',
  sessions: (n: number) => (n === 1 ? '1 séance' : `${n} séances`),
  deliverables: 'Ce que je remets',
  location: 'Lieu',
  steps: 'Étapes',
  safetyReminders: 'Consignes de sécurité',
  weatherAlternative: 'En cas de mauvais temps',
  purpose: 'But de l’évaluation',
  interpretation: 'Interpréter les réponses',
  signal: 'Si l’élève…',
  nextStep: 'Piste d’intervention',
  task: 'Tâche',
  criterion: 'Critère',
  level: (n: number) => `Niveau ${n}`,
  grouping: 'Organisation',
  rules: 'Règles',
  howToWin: 'Pour gagner',
  variations: 'Variantes',
  gameQuestions: 'Questions du jeu',
  space: 'Espace',
  calmVariant: 'Version calme',
  tune: 'Sur l’air de',
  gestures: 'Gestes',
  riddles: 'Devinettes',
  days: 'Chaque jour',
  hints: 'Indices',
  theme: 'Thème',
  scriptureReference: 'Référence biblique',
  prayer: 'Prière',
  action: 'Geste à poser',
  hook: 'Pour commencer',
  context: 'Contexte',
  discussionQuestions: 'Discutons',
  activity: 'Activité',
  factsToVerify: 'Faits à vérifier',
} as const;

export const QUESTION_KIND_LABELS_FR: Record<QuestionKind, string> = {
  multiple_choice: 'Choix multiple',
  true_false: 'Vrai ou faux',
  matching: 'Associations',
  ordering: 'Mise en ordre',
  short_answer: 'Réponse courte',
};

export const CATEGORY_LABELS_FR: Record<AchievementCategory, string> = {
  connaissance: 'Connaissance et compréhension',
  habiletes: 'Habiletés de la pensée',
  communication: 'Communication',
  application: 'Mise en application',
};

export const SUPERVISION_LABELS_FR: Record<Supervision, string> = {
  standard: 'Supervision habituelle',
  close: 'Supervision étroite',
  adult_only: 'Manipulations par un adulte seulement',
};

/** Stages of the « processus de design en ingénierie » (labels to be checked). */
export const DESIGN_STAGE_LABELS_FR: Record<string, string> = {
  definir: 'Définir le problème',
  rechercher: 'Rechercher',
  planifier: 'Planifier',
  construire: 'Construire',
  tester: 'Tester',
  ameliorer: 'Améliorer',
  communiquer: 'Communiquer',
};

export const WORD_CLASS_LABELS_FR: Record<string, string> = {
  nom: 'nom',
  verbe: 'verbe',
  adjectif: 'adjectif',
  adverbe: 'adverbe',
  expression: 'expression',
  autre: 'autre',
};

export const GENDER_LABELS_FR: Record<string, string> = { m: 'masc.', f: 'fém.' };

export const SPACE_LABELS_FR: Record<string, string> = {
  desk: 'À son pupitre',
  open: 'Dans un espace dégagé',
};

/** Labels of the family guide, in the language of each half. */
export const FAMILY_LABELS = {
  'fr-CA': {
    section: 'En français',
    intro: 'Ce que nous apprenons',
    learning: 'À l’école, votre enfant apprend à',
    atHome: 'À la maison, vous pouvez',
    words: 'Mots utiles',
  },
  'en-CA': {
    section: 'In English',
    intro: 'What we are learning',
    learning: 'At school, your child is learning to',
    atHome: 'At home, you can',
    words: 'Useful words',
  },
} as const;

export interface LessonPhaseLabels {
  opening: string;
  development: string;
  closing: string;
}

/** Phases of a lesson plan: the three-part math lesson, or before / during / after. */
export function lessonPhaseLabels(subjectCode: string | null | undefined): LessonPhaseLabels {
  return subjectCode === 'mat'
    ? { opening: 'Mise en train', development: 'Exploration', closing: 'Objectivation' }
    : { opening: 'Avant', development: 'Pendant', closing: 'Après' };
}

/** A, B, C… */
export const letter = (index: number) => String.fromCharCode(65 + index);
