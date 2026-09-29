/**
 * A day's plan shaped like the seed's 3e année (Mme Tremblay), for the PDF tests only: a routine,
 * a French lesson with the teacher's edits, a block replaced by the mass, a handover to the gym
 * teacher, groups with first names, and a Fiche whose « Gestion de classe » must never be printed.
 */
import {
  composeSubPlan,
  subPlanEditsSchema,
  subPlanV1Schema,
  type ComposedSubPlan,
  type SubPlanAudience,
  type SubPlanV1,
} from '@lynx/domain';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import type { PlanContext, PlanLevel, RosterStudent } from '../../components/sub-plans/types';
import { planPdfLabels } from './labels';

export const CLASS_3 = 'e0000000-0000-4000-8000-000000000003';
export const CLASS_5 = 'e0000000-0000-4000-8000-000000000005';
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const BLOCK = {
  entry: id('60000000', 1),
  french: id('60000000', 2),
  math: id('60000000', 3),
  gym: id('60000000', 4),
  dismissal: id('60000000', 5),
};
export const LESSON_4 = id('40000000', 4);
const DEBUTANT = id('70000000', 1);
const AVANCE = id('70000000', 2);
const student = (n: number) => id('50000000', n);

/** Text of the Fiche that paper must never carry. */
export const CLASS_MANAGEMENT =
  'Signal de silence : main levée. Samuel travaille mieux près du bureau.';
/** Teacher text with « », é and a narrow no-break space (U+202F), as typed in French. */
export const FRENCH_TYPOGRAPHY =
  'Lisez « Le huard » à voix haute\u202f; résumez l’idée principale.';

export function pdfPlan(overrides: Partial<SubPlanV1> = {}): SubPlanV1 {
  return subPlanV1Schema.parse({
    schemaVersion: 1,
    date: '2026-10-21',
    part: 'full_day',
    window: { start: '08:45', end: '15:20' },
    split: '12:55',
    day: { kind: 'weekly', dayKey: 3 },
    classes: [
      {
        classId: CLASS_3,
        name: '3e année – Mme Tremblay',
        gradeLabels: ['3e'],
        roomName: 'Local 101',
      },
    ],
    groups: [
      {
        key: 'G1',
        classId: CLASS_3,
        levelId: DEBUTANT,
        studentIds: [student(1), student(2), student(3)],
      },
      { key: 'G2', classId: CLASS_3, levelId: AVANCE, studentIds: [student(4), student(5)] },
      // Only a student who left the class: the group is not printed.
      { key: 'G3', classId: CLASS_3, levelId: null, studentIds: [student(9)] },
    ],
    dayEvents: [{ title: 'Assemblée', type: 'assembly', start: '12:05', end: '12:30' }],
    blocks: [
      {
        key: BLOCK.entry,
        classId: CLASS_3,
        className: '3e année – Mme Tremblay',
        kind: 'routine',
        start: '08:45',
        end: '08:55',
        status: 'normal',
        title: 'Entrée, prière du matin et O Canada',
        subjectLabel: null,
        roomName: 'Local 101',
        otherAdult: null,
        event: null,
        notes: null,
        lesson: null,
        steps: [{ minutes: null, text: 'Accueillez les élèves à la porte.' }],
        warnings: [],
      },
      {
        key: BLOCK.french,
        classId: CLASS_3,
        className: '3e année – Mme Tremblay',
        kind: 'subject',
        start: '08:55',
        end: '09:45',
        status: 'normal',
        title: 'Français',
        subjectLabel: 'Français',
        roomName: 'Local 101',
        otherAdult: null,
        event: null,
        notes: 'Les textes sont sur le bureau.',
        lesson: {
          lessonId: LESSON_4,
          unitTitle: 'Lire pour s’informer : les animaux de l’Ontario',
          sequenceNumber: 4,
          title: 'Trouver l’idée principale',
          objectives: 'Je peux trouver l’idée principale d’un paragraphe.',
          materials: 'Texte « Le huard »\r\nSurligneurs (bac vert)',
          content: 'Lecture guidée, puis travail en dyades.',
          subNotes: 'Les élèves du groupe débutant ont une version illustrée du texte (bac vert).',
          assignment: 'assigned',
          gapBefore: null,
        },
        steps: [
          { minutes: 10, text: 'Présentez l’intention d’apprentissage.' },
          { minutes: 30, text: 'Lecture guidée du texte.' },
        ],
        warnings: ['thin_lesson'],
      },
      {
        key: BLOCK.math,
        classId: CLASS_3,
        className: '3e année – Mme Tremblay',
        kind: 'subject',
        start: '09:45',
        end: '10:35',
        status: 'replaced',
        title: 'Mathématiques',
        subjectLabel: 'Mathématiques',
        roomName: 'Local 101',
        otherAdult: null,
        event: {
          title: 'Messe de l’école',
          notes: 'Au gymnase. Les élèves s’assoient par classe.',
          start: '09:45',
          end: '10:35',
        },
        notes: null,
        lesson: null,
        steps: [],
        warnings: [],
      },
      {
        key: BLOCK.gym,
        classId: CLASS_3,
        className: '3e année – Mme Tremblay',
        kind: 'handover',
        start: '13:35',
        end: '14:25',
        status: 'normal',
        title: 'EPS avec M. Leblanc',
        subjectLabel: 'Éducation physique et santé',
        roomName: 'Gymnase',
        otherAdult: 'M. Leblanc',
        event: null,
        notes: null,
        lesson: null,
        steps: [
          { minutes: null, text: 'Accompagnez les élèves au gymnase à 13 h 35.' },
          {
            minutes: null,
            text: 'Pendant ce temps, préparez la classe pour la dernière période : sortez les cahiers de calcul mental (tablette du fond) et les livres du bac près de la fenêtre.',
          },
        ],
        warnings: [],
      },
      {
        key: BLOCK.dismissal,
        classId: CLASS_3,
        className: '3e année – Mme Tremblay',
        kind: 'routine',
        start: '15:15',
        end: '15:20',
        status: 'normal',
        title: 'Départ',
        subjectLabel: null,
        roomName: 'Local 101',
        otherAdult: null,
        event: null,
        notes: null,
        lesson: null,
        steps: [],
        warnings: [],
      },
    ],
    classNotes: [
      {
        classId: CLASS_3,
        arrival: 'Les élèves accrochent leur sac et s’assoient en silence.',
        routines: 'Calendrier et météo après la prière.',
        classManagement: CLASS_MANAGEMENT,
        dismissal: 'Les autobus partent à 15 h 20 par la porte est.',
        fallbackActivities: 'Lecture libre au coin lecture.',
        neighbour: { name: 'M. Gagnon', note: 'Local 104, juste à côté' },
        team: [{ name: 'M. Leblanc', role: 'subject' }],
      },
    ],
    endOfDay: {
      time: '15:20',
      checklist: ['Fermez les fenêtres.', 'Laissez le suivi au secrétariat.'],
    },
    faith: {
      referenceId: id('80000000', 1),
      type: 'prayer',
      title: 'Prière pour la journée',
      text: 'Seigneur, guide nos pas aujourd’hui.',
    },
    warnings: [{ code: 'half_day_split_guessed', blockKey: null }],
    generator: { version: 'domain-1', generatedAt: '2026-10-20T10:00:00.000Z' },
    ...overrides,
  });
}

/** The teacher's overlay: her own steps for Français, a note and an overview. */
export const EDITS = subPlanEditsSchema.parse({
  overview: 'Journée calme; les élèves connaissent la routine.',
  blocks: {
    [BLOCK.french]: {
      forLessonId: LESSON_4,
      steps: [
        { minutes: 10, text: FRENCH_TYPOGRAPHY },
        { minutes: 30, text: 'Travail en dyades : surlignez l’idée principale.' },
      ],
      teacherNote: 'Les responsables de la semaine distribuent les textes.',
    },
  },
});

export function composed(
  audience: SubPlanAudience = 'pdf',
  plan: SubPlanV1 = pdfPlan(),
): ComposedSubPlan {
  return composeSubPlan(plan, { edits: EDITS, audience });
}

export const CONTEXT: PlanContext = {
  planId: id('90000000', 1),
  planDate: '2026-10-21',
  part: 'full_day',
  schoolName: 'É.É.C. Saint-Exemple',
  timezone: 'America/Toronto',
  officePhone: '555-0100',
  arrivalInstructions: 'Présentez-vous au secrétariat (local 100) à votre arrivée.',
  emergencyInfo: 'Sortie de secours : porte est. Point de rassemblement : terrain de soccer.',
  teacherName: 'Mme Tremblay',
  absenceNote: 'Merci! Les cahiers sont dans le bac bleu.',
};

export const ROSTER: RosterStudent[] = [
  { id: student(1), classId: CLASS_3, firstName: 'Samuel' },
  { id: student(2), classId: CLASS_3, firstName: 'Adam' },
  { id: student(3), classId: CLASS_3, firstName: 'Aïcha' },
  { id: student(4), classId: CLASS_3, firstName: 'Liam' },
  { id: student(5), classId: CLASS_3, firstName: 'Emma' },
];

export const LEVELS: PlanLevel[] = [
  {
    id: DEBUTANT,
    labelFr: 'Débutant',
    labelEn: 'Beginner',
    descriptionFr: 'Comprend des consignes courtes, avec des images.',
    sortOrder: 1,
  },
  { id: AVANCE, labelFr: 'Avancé', labelEn: 'Advanced', descriptionFr: null, sortOrder: 3 },
];

export const FR_LABELS = planPdfLabels('fr-CA', fr);
export const EN_LABELS = planPdfLabels('en-CA', en as typeof fr);
