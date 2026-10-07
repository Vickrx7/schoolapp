/**
 * Evaluation set for « Créer une banque avec l’IA » (report_comment_bank, DECISIONS D-132): ten
 * requests as the database builds them (labels and attente texts from the demo curriculum, ids as
 * in the demo database), one per kind of bank worth checking: subjects with attentes on both
 * reports, a subject without attentes (« commentaires généraux »), the learning skills on both
 * reports, Enseignement religieux, and a note that names a student, who must never reach the bank.
 * All fictional.
 *
 *   pnpm ai:eval --feature report_comment_bank --provider fake
 *   pnpm ai:eval --feature report_comment_bank --case mat-3e-term --yes   # one real case, under $1
 */
import type { KnownPerson } from '../privacy';
import type {
  ReportBankExpectation,
  ReportCommentBankInput,
} from '../features/report-comment-bank';
import type { ReportCommentBankExpectations } from './checks';

export interface ReportCommentBankCase {
  id: string;
  title: string;
  /** As `app.report_comment_bank_ai_input` returns it. */
  input: ReportCommentBankInput;
  people?: KnownPerson[];
  expect: ReportCommentBankExpectations;
}

const MAT = '84536e87-0e13-4daf-bfcc-8ba91b4a7f0d';
const FRA = 'ef2c8939-059f-4f2c-b96b-881338ded7e5';
const SCI = '79159821-b268-4bd1-9f5c-503be4737e6d';
const ERE = '5c0c4af1-29ca-480f-83d6-7f47e7ab5ebd';

const exp = (
  n: number,
  expectationId: string,
  code: string,
  strandLabel: string,
  text: string,
): ReportBankExpectation => ({
  key: `E${n}`,
  expectationId,
  code,
  text,
  kind: 'specific',
  strandLabel,
});

const grade = (code: string) => ({
  gradeCodes: [code],
  gradeLabels: [code === '1' ? '1re année' : `${code}e année`],
});

const base = { itemType: 'report_comments' as const, teacherNote: '' };

export const reportCommentBankCases: ReportCommentBankCase[] = [
  {
    id: 'mat-3e-term',
    title: 'Mathématiques, 3e année, bulletin scolaire, trois attentes',
    input: {
      ...base,
      ...grade('3'),
      scope: 'subject',
      period: 'term',
      length: 'medium',
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      expectations: [
        exp(
          1,
          '20000000-0000-4000-8000-000000030b11',
          'B1.1',
          'Nombres',
          "Lire, représenter, composer et décomposer des nombres naturels jusqu'à 1 000 de différentes façons.",
        ),
        exp(
          2,
          '20000000-0000-4000-8000-000000030b12',
          'B1.2',
          'Nombres',
          "Comparer et ordonner des nombres naturels jusqu'à 1 000.",
        ),
        exp(
          3,
          'bda2ac2c-8e8d-5235-aecd-fc09f7e467c2',
          'B2.3',
          'Nombres',
          'Utiliser des stratégies de calcul mental, dont l’estimation, pour additionner et soustraire des nombres naturels dont la somme ne dépasse pas 1 000, et expliquer les stratégies utilisées.',
        ),
      ],
    },
    expect: { minEntriesPerExpectation: 8 },
  },
  {
    id: 'mat-5e-progress',
    title: 'Mathématiques, 5e année, bulletin de progrès, entrées courtes',
    input: {
      ...base,
      ...grade('5'),
      scope: 'subject',
      period: 'progress',
      length: 'short',
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      expectations: [
        exp(
          1,
          '20000000-0000-4000-8000-000000050b11',
          'B1.5',
          'Nombres',
          "Représenter des fractions équivalentes à l'aide de modèles et de droites numériques.",
        ),
        exp(
          2,
          'b5338861-e576-5ff4-a466-6440f71fedef',
          'C1.1',
          'Algèbre',
          'Reconnaître et décrire des suites à motif répété, des suites croissantes et des suites décroissantes, dont des suites croissantes linéaires, y compris dans la vie courante.',
        ),
      ],
    },
    expect: { minEntriesPerExpectation: 6 },
  },
  {
    id: 'fra-3e-term',
    title: 'Français, 3e année, bulletin scolaire, lecture et écriture',
    input: {
      ...base,
      ...grade('3'),
      scope: 'subject',
      period: 'term',
      length: 'medium',
      subjectId: FRA,
      subjectLabel: 'Français',
      expectations: [
        exp(
          1,
          '20000000-0000-4000-8000-000000030c11',
          'C1.1',
          'Compréhension : comprendre et réagir à des textes',
          'Faire des prédictions et activer ses connaissances antérieures avant la lecture.',
        ),
        exp(
          2,
          '20000000-0000-4000-8000-000000030c12',
          'C1.2',
          'Compréhension : comprendre et réagir à des textes',
          "Repérer l'idée principale et quelques détails importants d'un texte informatif.",
        ),
        exp(
          3,
          '20000000-0000-4000-8000-000000030d11',
          'D1.1',
          'Composition : exprimer ses idées et créer des textes',
          "Organiser ses idées à l'aide d'un organisateur graphique avant d'écrire.",
        ),
      ],
    },
    expect: { minEntriesPerExpectation: 8 },
  },
  {
    id: 'fra-5e-progress',
    title: 'Français, 5e année, bulletin de progrès',
    input: {
      ...base,
      ...grade('5'),
      scope: 'subject',
      period: 'progress',
      length: 'medium',
      subjectId: FRA,
      subjectLabel: 'Français',
      expectations: [
        exp(
          1,
          'de1ffbc5-dcc4-531b-b392-9a1fe2177a71',
          'C1.3',
          'Compréhension : comprendre et réagir à des textes',
          'Utiliser les caractéristiques des textes informatifs (intertitres, encadrés, schémas, tableaux, glossaire) pour trouver et relier de l’information.',
        ),
        exp(
          2,
          '20000000-0000-4000-8000-000000051d11',
          'D1.1',
          'Composition : exprimer ses idées et créer des textes',
          'Organiser ses idées et l’information recueillie à l’aide d’un organisateur graphique avant d’écrire.',
        ),
      ],
    },
    expect: { minEntriesPerExpectation: 6 },
  },
  {
    id: 'sci-3e-term',
    title: 'Sciences et technologie, 3e année, bulletin scolaire, entrées courtes',
    input: {
      ...base,
      ...grade('3'),
      scope: 'subject',
      period: 'term',
      length: 'short',
      subjectId: SCI,
      subjectLabel: 'Sciences et technologie',
      expectations: [
        exp(
          1,
          'b14c3029-c52f-51b7-9fb9-c3c093a56e40',
          'B1.1',
          'Systèmes vivants',
          'Évaluer l’importance des plantes pour les humains et les autres êtres vivants, en tenant compte de divers points de vue, et proposer des façons de protéger les plantes indigènes et leurs habitats.',
        ),
        exp(
          2,
          'e7d6249b-f6e1-5dff-a8bd-d9d089dff60a',
          'B2.1',
          'Systèmes vivants',
          'Décrire les besoins essentiels des plantes (air, eau, lumière, chaleur, espace, nutriments).',
        ),
      ],
    },
    expect: { minEntriesPerExpectation: 8 },
  },
  {
    id: 'sci-5e-general',
    title: 'Sciences et technologie, 5e année, sans attente (commentaires généraux)',
    input: {
      ...base,
      ...grade('5'),
      scope: 'subject',
      period: 'term',
      length: 'medium',
      subjectId: SCI,
      subjectLabel: 'Sciences et technologie',
      expectations: [],
    },
    expect: {},
  },
  {
    id: 'skills-3e-term',
    title: 'Habiletés d’apprentissage et habitudes de travail, 3e année, bulletin scolaire',
    input: {
      ...base,
      ...grade('3'),
      scope: 'learning_skills',
      period: 'term',
      length: 'medium',
      subjectId: null,
      subjectLabel: null,
      expectations: [],
    },
    expect: {},
  },
  {
    id: 'skills-6e-progress',
    title: 'Habiletés d’apprentissage et habitudes de travail, 6e année, bulletin de progrès',
    input: {
      ...base,
      ...grade('6'),
      scope: 'learning_skills',
      period: 'progress',
      length: 'short',
      subjectId: null,
      subjectLabel: null,
      expectations: [],
    },
    expect: {},
  },
  {
    id: 'ere-2e-term',
    title: 'Enseignement religieux, 2e année, bulletin scolaire, sans attente',
    input: {
      ...base,
      ...grade('2'),
      scope: 'religion',
      period: 'term',
      length: 'medium',
      subjectId: ERE,
      subjectLabel: 'Enseignement religieux',
      expectations: [],
    },
    expect: {},
  },
  {
    id: 'note-names-student',
    title: 'Mathématiques, 3e année : une note qui nomme une élève',
    input: {
      ...base,
      ...grade('3'),
      scope: 'subject',
      period: 'term',
      length: 'medium',
      subjectId: MAT,
      subjectLabel: 'Mathématiques',
      expectations: [
        exp(
          1,
          '20000000-0000-4000-8000-000000030b12',
          'B1.2',
          'Nombres',
          "Comparer et ordonner des nombres naturels jusqu'à 1 000.",
        ),
      ],
      teacherNote:
        'Comme pour Aïcha cette année, prévoir des prochaines étapes avec la droite numérique et du matériel de manipulation.',
    },
    people: [
      { name: 'Aïcha', kind: 'student' },
      { name: 'Isabelle Tremblay', kind: 'staff' },
    ],
    expect: { absentNames: ['Aïcha'], minEntriesPerExpectation: 8 },
  },
];
