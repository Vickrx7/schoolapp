/**
 * Test data shaped like `supabase/seed.sql` (3e année of Mme Tremblay, 5e année of M. Gagnon,
 * M. Leblanc teaching EPS and Anglais), as `app.sub_plan_sources` returns it, and the demo
 * library (`content/library/demo`) as `app.sub_plan_library_sources` returns it. Used by the
 * sub-plan unit tests only; not exported from the package.
 */
import { readFileSync } from 'node:fs';
import { seedItemId, seedItemSchema } from '@lynx/content';
import { subPlanSourcesSchema, type SubPlanSources, type SubPlanSourcesInput } from './sources';

type RawSources = Exclude<SubPlanSourcesInput, null | undefined>;
type Raw<K extends keyof RawSources> = NonNullable<RawSources[K]>;
export type RawEvent = NonNullable<Raw<'events'>>[number];

export const BOARD = 'b0000000-0000-4000-8000-000000000001';
export const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
export const ISABELLE = 'd0000000-0000-4000-8000-000000000001';
export const MARC = 'd0000000-0000-4000-8000-000000000002';
export const PAUL = 'd0000000-0000-4000-8000-000000000003';
export const C3 = 'e0000000-0000-4000-8000-000000000003';
export const C5 = 'e0000000-0000-4000-8000-000000000005';
export const ROOM_101 = 'f0000000-0000-4000-8000-000000000101';
export const ROOM_104 = 'f0000000-0000-4000-8000-000000000104';
export const GYM = 'f0000000-0000-4000-8000-000000000201';
export const LIBRARY = 'f0000000-0000-4000-8000-000000000202';

const SUBJECT_CODES = ['fra', 'mat', 'sci', 'etu', 'eps', 'art', 'ere', 'ang'] as const;
type SubjectCode = (typeof SUBJECT_CODES)[number];
export const SUBJECT: Record<SubjectCode, string> = Object.fromEntries(
  SUBJECT_CODES.map((c, i) => [
    c,
    `5b000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
  ]),
) as Record<SubjectCode, string>;
const SUBJECT_LABELS: Record<SubjectCode, string> = {
  fra: 'Français',
  mat: 'Mathématiques',
  sci: 'Sciences et technologie',
  etu: 'Études sociales',
  eps: 'Éducation physique et santé',
  art: 'Éducation artistique',
  ere: 'Enseignement religieux',
  ang: 'Anglais',
};

export const UNIT = {
  fra3: '30000000-0000-4000-8000-000000000301',
  mat3: '30000000-0000-4000-8000-000000000302',
  mat5: '30000000-0000-4000-8000-000000000501',
  sci5: '30000000-0000-4000-8000-000000000502',
} as const;

/** Lesson `n` of a unit, e.g. lesson('fra3', 4). */
export function lesson(unit: keyof typeof UNIT, n: number): string {
  return `40000000-0000-4000-8000-000000${UNIT[unit].slice(-4)}${String(n).padStart(2, '0')}`;
}

/** The timetable block of a class on a weekday (1 = Monday) at a start time. */
export function block(classId: string, dayKey: number, start: string): string {
  return `60000000-0000-4000-8000-00000${classId.slice(-2)}${dayKey}${start.replace(':', '')}`;
}

export function student(classId: string, n: number): string {
  return `70000000-0000-4000-8000-000000${classId.slice(-2)}${String(n).padStart(4, '0')}`;
}

export const LEVEL = {
  debutant: 'd1000000-0000-4000-8000-000000000010',
  intermediaire: 'd1000000-0000-4000-8000-000000000020',
  avance: 'd1000000-0000-4000-8000-000000000030',
  enrichi: 'd1000000-0000-4000-8000-000000000040',
} as const;

let eventCount = 0;
export function event(overrides: Partial<RawEvent> & Pick<RawEvent, 'startsOn'>): RawEvent {
  eventCount += 1;
  return {
    id: `e1000000-0000-4000-8000-${String(eventCount).padStart(12, '0')}`,
    eventType: 'mass',
    title: 'Messe de l’école',
    notes: null,
    endsOn: overrides.startsOn,
    startTime: null,
    endTime: null,
    affectsSchedule: true,
    classId: null,
    ...overrides,
  };
}

/** A Monday..Friday with no seeded events: 2026-10-19..23, then Monday 2026-10-26. */
export const WEEK = {
  mon: '2026-10-19',
  tue: '2026-10-20',
  wed: '2026-10-21',
  thu: '2026-10-22',
  fri: '2026-10-23',
  sat: '2026-10-24',
  sun: '2026-10-25',
  nextMon: '2026-10-26',
  nextTue: '2026-10-27',
} as const;

const ROUTINES: [string, string, string, string][] = [
  ['08:45', '08:55', 'routine', 'Entrée, prière du matin et O Canada'],
  ['10:35', '11:15', 'nutrition_break', 'Première pause santé'],
  ['12:55', '13:35', 'nutrition_break', 'Deuxième pause santé'],
  ['15:15', '15:20', 'routine', 'Rangement, prière et départ'],
];

// (class, day, start, end, subject, teacher, room): the seed's teaching blocks.
const TEACHING: [string, number, string, string, SubjectCode, string | null, string | null][] = [
  [C3, 1, '08:55', '09:45', 'fra', null, null],
  [C3, 1, '09:45', '10:35', 'mat', null, null],
  [C3, 1, '11:15', '12:05', 'fra', null, null],
  [C3, 1, '12:05', '12:55', 'ere', null, null],
  [C3, 1, '13:35', '14:25', 'sci', null, null],
  [C3, 1, '14:25', '15:15', 'art', null, null],
  [C3, 2, '08:55', '09:45', 'fra', null, null],
  [C3, 2, '09:45', '10:35', 'mat', null, null],
  [C3, 2, '11:15', '12:05', 'fra', null, null],
  [C3, 2, '12:05', '12:55', 'etu', null, null],
  [C3, 2, '13:35', '14:25', 'eps', PAUL, GYM],
  [C3, 2, '14:25', '15:15', 'mat', null, null],
  [C3, 3, '08:55', '09:45', 'fra', null, null],
  [C3, 3, '09:45', '10:35', 'mat', null, null],
  [C3, 3, '11:15', '12:05', 'sci', null, null],
  [C3, 3, '12:05', '12:55', 'ere', null, null],
  [C3, 3, '13:35', '14:25', 'fra', null, null],
  [C3, 3, '14:25', '15:15', 'eps', null, GYM],
  [C3, 4, '08:55', '09:45', 'fra', null, null],
  [C3, 4, '09:45', '10:35', 'mat', null, null],
  [C3, 4, '11:15', '12:05', 'fra', null, null],
  [C3, 4, '12:05', '12:55', 'etu', null, null],
  [C3, 4, '13:35', '14:25', 'eps', PAUL, GYM],
  [C3, 4, '14:25', '15:15', 'art', null, null],
  [C3, 5, '08:55', '09:45', 'fra', null, null],
  [C3, 5, '09:45', '10:35', 'mat', null, null],
  [C3, 5, '11:15', '12:05', 'ere', null, null],
  [C3, 5, '12:05', '12:55', 'sci', null, null],
  [C3, 5, '13:35', '14:25', 'fra', null, LIBRARY],
  [C3, 5, '14:25', '15:15', 'eps', null, GYM],
  [C5, 1, '08:55', '09:45', 'mat', null, null],
  [C5, 1, '09:45', '10:35', 'fra', null, null],
  [C5, 1, '11:15', '12:05', 'ang', PAUL, null],
  [C5, 1, '12:05', '12:55', 'fra', null, null],
  [C5, 1, '13:35', '14:25', 'sci', null, null],
  [C5, 1, '14:25', '15:15', 'ere', null, null],
  [C5, 2, '08:55', '09:45', 'mat', null, null],
  [C5, 2, '09:45', '10:35', 'fra', null, null],
  [C5, 2, '11:15', '12:05', 'etu', null, null],
  [C5, 2, '12:05', '12:55', 'fra', null, null],
  [C5, 2, '13:35', '14:25', 'sci', null, null],
  [C5, 2, '14:25', '15:15', 'eps', null, GYM],
  [C5, 3, '08:55', '09:45', 'mat', null, null],
  [C5, 3, '09:45', '10:35', 'fra', null, null],
  [C5, 3, '11:15', '12:05', 'ang', PAUL, null],
  [C5, 3, '12:05', '12:55', 'ere', null, null],
  [C5, 3, '13:35', '14:25', 'fra', null, null],
  [C5, 3, '14:25', '15:15', 'art', null, null],
  [C5, 4, '08:55', '09:45', 'mat', null, null],
  [C5, 4, '09:45', '10:35', 'fra', null, null],
  [C5, 4, '11:15', '12:05', 'sci', null, null],
  [C5, 4, '12:05', '12:55', 'fra', null, null],
  [C5, 4, '13:35', '14:25', 'etu', null, null],
  [C5, 4, '14:25', '15:15', 'eps', null, GYM],
  [C5, 5, '08:55', '09:45', 'mat', null, null],
  [C5, 5, '09:45', '10:35', 'fra', null, null],
  [C5, 5, '11:15', '12:05', 'ang', PAUL, null],
  [C5, 5, '12:05', '12:55', 'sci', null, null],
  [C5, 5, '13:35', '14:25', 'art', null, null],
  [C5, 5, '14:25', '15:15', 'ere', null, null],
];

function blocks(): Raw<'blocks'> {
  const routines = [C3, C5].flatMap((classId) =>
    [1, 2, 3, 4, 5].flatMap((dayKey) =>
      ROUTINES.map(([startTime, endTime, kind, title]) => ({
        id: block(classId, dayKey, startTime),
        classId,
        dayKey,
        startTime: `${startTime}:00`, // as Postgres returns them; the schema normalizes
        endTime,
        kind: kind as 'routine' | 'nutrition_break',
        subjectId: null,
        title,
        teacherId: null,
        roomId: null,
        notes: null,
      })),
    ),
  );
  const teaching = TEACHING.map(
    ([classId, dayKey, startTime, endTime, code, teacherId, roomId]) => ({
      id: block(classId, dayKey, startTime),
      classId,
      dayKey,
      startTime,
      endTime,
      kind: 'subject' as const,
      subjectId: SUBJECT[code],
      title: null,
      teacherId,
      roomId,
      notes: null,
    }),
  );
  return [...routines, ...teaching];
}

type LessonRow = [string, string | null, string | null, string | null, string | null];
const LESSONS: Record<keyof typeof UNIT, LessonRow[]> = {
  fra3: [
    [
      'Qu’est-ce qu’un texte informatif?',
      'Distinguer un texte informatif d’un récit.',
      'Deux livres de la bibliothèque de classe (un récit, un documentaire).',
      'Comparer les deux livres en grand groupe. Noter les différences au tableau.',
      null,
    ],
    [
      'Les caractéristiques d’un texte informatif',
      'Repérer titres, sous-titres, images et légendes.',
      'Affiche « Les parties d’un documentaire », surligneurs.',
      'Lecture guidée d’une page sur le castor. Les élèves surlignent les caractéristiques.',
      null,
    ],
    [
      'Prédire avant de lire',
      'Faire des prédictions à partir du titre et des images.',
      'Texte « L’ours noir » (photocopies dans le bac bleu).',
      'Tour de table des prédictions, puis lecture à voix haute par l’enseignante.',
      null,
    ],
    [
      'Trouver l’idée principale',
      'Repérer l’idée principale d’un paragraphe.',
      'Texte « Le huard », organisateur graphique « idée principale et détails ».',
      'Modéliser avec le premier paragraphe, puis travail en dyades pour les deux suivants. Retour en grand groupe.',
      'Les élèves au niveau Débutant peuvent travailler avec la version illustrée du texte (bac vert).',
    ],
    [
      'Les détails importants',
      'Distinguer un détail important d’un détail secondaire.',
      'Texte « Le huard », crayons de couleur.',
      'Jeu du tri : détails importants ou non? Les élèves justifient leur choix.',
      null,
    ],
    [
      'Choisir mon animal',
      'Choisir un animal et formuler trois questions.',
      'Livres documentaires sur les animaux de l’Ontario (bibliothèque).',
      'Les élèves choisissent un animal et écrivent trois questions dans leur cahier.',
      null,
    ],
    [
      'Planifier ma fiche',
      'Organiser ses idées avec un organisateur graphique.',
      'Organisateur graphique « Ma fiche animale ».',
      'Remplir l’organisateur à partir des lectures.',
      null,
    ],
    [
      'Rédiger ma fiche',
      'Rédiger une courte fiche informative.',
      'Gabarit de fiche, crayons de couleur.',
      'Rédaction et illustration de la fiche. Partage en petits groupes.',
      null,
    ],
  ],
  mat3: [
    [
      'Centaines, dizaines, unités',
      'Représenter des nombres jusqu’à 1 000 avec du matériel de base dix.',
      'Blocs de base dix (armoire du fond).',
      'Construire des nombres dictés par l’enseignante, puis en équipe.',
      null,
    ],
    [
      'Composer et décomposer',
      'Décomposer un nombre de plusieurs façons.',
      'Blocs de base dix, ardoises.',
      'Trouver au moins trois façons de représenter 347.',
      null,
    ],
    [
      'Lire et écrire les nombres',
      'Lire et écrire des nombres en chiffres et en lettres.',
      'Cartes-nombres.',
      'Jeu du mémo : associer les chiffres et les mots.',
      null,
    ],
    [
      'Comparer des nombres',
      'Comparer des nombres avec <, > et =.',
      'Droite numérique géante (au sol), cartes-nombres.',
      'Placer des nombres sur la droite numérique et les comparer.',
      null,
    ],
    [
      'Ordonner des nombres',
      'Ordonner des nombres en ordre croissant et décroissant.',
      'Cartes-nombres, fiche d’exercices.',
      'Travail en équipes de trois, puis fiche individuelle.',
      'La fiche d’exercices est dans le cartable rouge sur le bureau.',
    ],
    [
      'Arrondir à la dizaine',
      'Arrondir à la dizaine près.',
      'Droite numérique.',
      'Utiliser la droite numérique pour voir la dizaine la plus proche.',
      null,
    ],
    [
      'Arrondir à la centaine',
      'Arrondir à la centaine près.',
      'Droite numérique.',
      'Problèmes de la vie courante (prix, distances).',
      null,
    ],
    [
      'Défi des nombres',
      'Réinvestir les apprentissages de l’unité.',
      'Fiche « Défi des nombres ».',
      'Circuit de quatre ateliers.',
      null,
    ],
  ],
  mat5: [
    [
      'Retour sur les fractions',
      'Représenter des fractions simples.',
      'Réglettes fractionnaires.',
      'Activité de rappel en dyades.',
      null,
    ],
    [
      'Fractions équivalentes (1)',
      'Trouver des fractions équivalentes avec des modèles.',
      'Réglettes fractionnaires, papier quadrillé.',
      'Exploration guidée, puis mise en commun.',
      null,
    ],
    [
      'Fractions équivalentes (2)',
      'Trouver des fractions équivalentes sur une droite numérique.',
      'Droites numériques imprimées.',
      'Travail individuel puis correction collective.',
      null,
    ],
    [
      'Comparer des fractions',
      'Comparer des fractions avec des repères (0, 1/2, 1).',
      'Cartes-fractions.',
      'Jeu de la bataille des fractions.',
      null,
    ],
    [
      'Les dixièmes',
      'Relier les dixièmes aux fractions.',
      'Grilles de 10, crayons de couleur.',
      'Colorier et écrire la fraction et le nombre décimal.',
      null,
    ],
    [
      'Les centièmes',
      'Relier les centièmes aux fractions.',
      'Grilles de 100.',
      'Colorier des grilles de 100 et écrire le nombre décimal.',
      'Les grilles de 100 sont dans le tiroir du haut du classeur gris.',
    ],
    [
      'Comparer des nombres décimaux',
      'Comparer et ordonner des nombres décimaux jusqu’aux centièmes.',
      'Circulaires d’épicerie.',
      'Classer des prix du plus petit au plus grand.',
      null,
    ],
    [
      'Tâche de synthèse',
      'Réinvestir les apprentissages de l’unité.',
      'Tâche « Le marché du village ».',
      'Tâche individuelle.',
      null,
    ],
  ],
  sci5: [
    [
      'Qu’est-ce qu’une force?',
      'Définir une force comme une poussée ou une traction.',
      'Objets variés (ballon, élastique, livre).',
      'Stations d’exploration, puis mise en commun.',
      null,
    ],
    [
      'Forces externes',
      'Identifier les forces externes qui agissent sur une structure.',
      'Photos de ponts et d’édifices.',
      'Analyse de photos en équipe.',
      null,
    ],
    [
      'Compression et tension',
      'Observer la compression et la tension.',
      'Éponges, élastiques.',
      'Expériences simples en dyades.',
      'Distribuer une éponge et un élastique par dyade; les élèves ne lancent pas les élastiques.',
    ],
    [
      'Torsion et cisaillement',
      'Observer la torsion et le cisaillement.',
      'Pâte à modeler, ciseaux.',
      'Démonstration puis essais.',
      null,
    ],
    [
      'La forme compte',
      'Comparer la solidité de différentes formes.',
      'Papier, ruban adhésif, livres.',
      'Construire des colonnes de formes différentes et tester leur résistance.',
      null,
    ],
    [
      'Les matériaux comptent',
      'Comparer des matériaux de construction.',
      'Pailles, bâtonnets, carton.',
      'Tests de flexibilité et de résistance.',
      null,
    ],
    [
      'Défi : le pont le plus solide',
      'Concevoir et construire un pont.',
      'Bâtonnets, colle blanche, ruban adhésif.',
      'Défi de conception en équipe.',
      null,
    ],
    [
      'Tester et améliorer',
      'Tester le pont et proposer des améliorations.',
      'Ponts construits, poids.',
      'Tests et réflexion écrite.',
      null,
    ],
  ],
};

function units(): Raw<'units'> {
  const meta: Record<keyof typeof UNIT, [string, SubjectCode, string]> = {
    fra3: [C3, 'fra', 'Lire pour s’informer : les animaux de l’Ontario'],
    mat3: [C3, 'mat', 'Les nombres jusqu’à 1 000'],
    mat5: [C5, 'mat', 'Fractions et nombres décimaux'],
    sci5: [C5, 'sci', 'Les forces qui agissent sur les structures'],
  };
  return (Object.keys(UNIT) as (keyof typeof UNIT)[]).map((key) => ({
    id: UNIT[key],
    classId: meta[key][0],
    subjectId: SUBJECT[meta[key][1]],
    title: meta[key][2],
    lessons: LESSONS[key].map(([title, objectives, materials, content, subNotes], i) => ({
      id: lesson(key, i + 1),
      sequenceNumber: i + 1,
      title,
      objectives,
      materials,
      content,
      subNotes,
      durationMinutes: 50,
    })),
  }));
}

/** Lessons 1..done of a unit completed on school days before WEEK.mon. */
export function completed(unit: keyof typeof UNIT, done: number): Raw<'progress'> {
  return Array.from({ length: done }, (_, i) => ({
    lessonId: lesson(unit, i + 1),
    status: 'completed' as const,
    taughtOn: `2026-10-${String(9 + i).padStart(2, '0')}`,
  }));
}

const LEVELS_3E = [
  'avance',
  'avance',
  'enrichi',
  'intermediaire',
  'avance',
  'debutant',
  'avance',
  'intermediaire',
  'enrichi',
  'debutant',
  'avance',
  'avance',
  'debutant',
  'intermediaire',
  'avance',
  'avance',
  'intermediaire',
  'avance',
  'enrichi',
  'avance',
] as const;
const LEVELS_5E = [
  'avance',
  'avance',
  'enrichi',
  'intermediaire',
  'avance',
  'avance',
  'debutant',
  'avance',
  'enrichi',
  'intermediaire',
  'avance',
  'avance',
  'debutant',
  'intermediaire',
  'avance',
  'avance',
  'debutant',
  'intermediaire',
  'enrichi',
  'avance',
] as const;
/** In the seed, students 6, 10 and 13 of the 3e are Samuel, Adam and Aïcha (Débutant). */
export const DEBUTANTS_3E = [student(C3, 6), student(C3, 10), student(C3, 13)];

function students(): Raw<'students'> {
  return [
    ...LEVELS_3E.map((level, i) => ({
      id: student(C3, i + 1),
      classId: C3,
      levelId: LEVEL[level],
      active: true,
    })),
    ...LEVELS_5E.map((level, i) => ({
      id: student(C5, i + 1),
      classId: C5,
      levelId: LEVEL[level],
      active: true,
    })),
  ];
}

const TEAM = {
  isabelle: { userId: ISABELLE, displayName: 'Isabelle Tremblay', honorific: 'Mme' },
  marc: { userId: MARC, displayName: 'Marc Gagnon', honorific: 'M.' },
  paul: { userId: PAUL, displayName: 'Paul Leblanc', honorific: 'M.' },
};

const CATHOLIC: Raw<'catholicReferences'> = [
  [
    'virtue',
    'Le respect',
    'Je traite les autres comme j’aimerais être traité, en paroles et en gestes.',
    -1,
    8,
    null,
    ['respect', 'communauté'],
  ],
  [
    'virtue',
    'La persévérance',
    'Quand une tâche est difficile, je continue d’essayer et je demande de l’aide au besoin.',
    1,
    8,
    null,
    ['persévérance', 'effort'],
  ],
  [
    'virtue',
    'La compassion',
    'Je remarque quand quelqu’un a de la peine et je cherche une façon de l’aider.',
    -1,
    8,
    null,
    ['compassion', 'entraide'],
  ],
  [
    'reflection',
    'Prendre soin de la création',
    'Comment peux-tu prendre soin de la nature et des animaux autour de toi cette semaine?',
    1,
    8,
    null,
    ['création', 'environnement', 'sciences'],
  ],
  [
    'reflection',
    'Dire merci',
    'Nomme trois personnes ou trois choses pour lesquelles tu veux dire merci aujourd’hui.',
    -1,
    8,
    'temps_ordinaire',
    ['gratitude', 'action de grâce'],
  ],
  [
    'prayer',
    'Prière avant le travail',
    'Seigneur, aide-moi à bien écouter, à faire de mon mieux et à aider mes amis aujourd’hui. Amen.',
    -1,
    6,
    null,
    ['prière', 'journée'],
  ],
  [
    'prayer',
    'Prière de l’Avent',
    'Seigneur, pendant ce temps d’attente, rends nos cœurs prêts à t’accueillir et à partager avec les autres. Amen.',
    -1,
    8,
    'avent',
    ['avent', 'partage'],
  ],
].map(([type, title, textFr, gradeMin, gradeMax, liturgicalSeason, tags], i) => ({
  id: `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  boardId: BOARD,
  type: type as 'virtue' | 'reflection' | 'prayer',
  title: title as string,
  textFr: textFr as string,
  gradeMin: gradeMin as number,
  gradeMax: gradeMax as number,
  liturgicalSeason: liturgicalSeason as 'temps_ordinaire' | 'avent' | null,
  tags: tags as string[],
}));

/** What app.sub_plan_sources returns for Isabelle (3e homeroom) with the seed's data. */
export function isabelleSources(): RawSources {
  return {
    today: WEEK.mon,
    teacher: { id: ISABELLE, displayName: 'Isabelle Tremblay', honorific: 'Mme' },
    school: {
      id: SCHOOL,
      boardId: BOARD,
      timezone: 'America/Toronto',
      scheduleType: 'weekly',
      cycleLength: null,
      settings: { contact: { officePhone: '555-0100' } },
    },
    classes: [
      {
        id: C3,
        name: '3e année – Mme Tremblay',
        roomId: ROOM_101,
        role: 'homeroom',
        grades: [{ code: '3', ordinal: 3, labelFr: '3e année' }],
      },
    ],
    team: [
      { classId: C3, ...TEAM.isabelle, role: 'homeroom' },
      { classId: C3, ...TEAM.paul, role: 'subject' },
    ],
    blocks: blocks().filter((b) => b.classId === C3),
    events: [],
    anchors: [],
    rooms: [
      { id: ROOM_101, name: 'Local 101' },
      { id: ROOM_104, name: 'Local 104' },
      { id: GYM, name: 'Gymnase' },
      { id: LIBRARY, name: 'Bibliothèque' },
    ],
    subjects: SUBJECT_CODES.map((c) => ({ id: SUBJECT[c], labelFr: SUBJECT_LABELS[c] })),
    units: units().filter((u) => u.classId === C3),
    progress: [...completed('fra3', 3), ...completed('mat3', 4)],
    students: students().filter((s) => s.classId === C3),
    levels: [
      {
        id: LEVEL.debutant,
        labelFr: 'Débutant',
        labelEn: 'Beginner',
        descriptionFr:
          'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.',
        sortOrder: 10,
      },
      {
        id: LEVEL.intermediaire,
        labelFr: 'Intermédiaire',
        labelEn: 'Intermediate',
        descriptionFr: 'Phrases simples et vocabulaire courant, quelques mots nouveaux expliqués.',
        sortOrder: 20,
      },
      {
        id: LEVEL.avance,
        labelFr: 'Avancé',
        labelEn: 'Advanced',
        descriptionFr: 'Texte du niveau scolaire attendu.',
        sortOrder: 30,
      },
      {
        id: LEVEL.enrichi,
        labelFr: 'Enrichi',
        labelEn: 'Enriched',
        descriptionFr: 'Vocabulaire plus riche et questions d’approfondissement.',
        sortOrder: 40,
      },
    ],
    profiles: [
      {
        classId: C3,
        arrivalNotes:
          'Les élèves entrent par la porte 3 et accrochent leur manteau avant la cloche.',
        routinesNotes:
          'Après la prière : calendrier et météo avec l’élève responsable de la semaine.',
        classroomManagementNotes:
          'Signal de silence : main levée. Un coin calme est au fond de la classe.',
        dismissalNotes:
          'Les élèves de l’autobus 12 partent à 15 h 15; les autres attendent la cloche.',
        fallbackActivities:
          'Lecture libre (bac jaune), puis dessin de l’animal préféré dans le cahier d’écriture.',
        neighbourNote: 'Local 104, juste à côté',
        neighbour: { displayName: TEAM.marc.displayName, honorific: TEAM.marc.honorific },
      },
    ],
    catholicReferences: CATHOLIC,
    siblings: [],
  };
}

/** The same school seen by Paul Leblanc: subject teacher in the 3e and the 5e, no homeroom. */
export function paulSources(): RawSources {
  const base = isabelleSources();
  return {
    ...base,
    teacher: { id: PAUL, displayName: 'Paul Leblanc', honorific: 'M.' },
    classes: [
      {
        id: C3,
        name: '3e année – Mme Tremblay',
        roomId: ROOM_101,
        role: 'subject',
        grades: [{ code: '3', ordinal: 3, labelFr: '3e année' }],
      },
      {
        id: C5,
        name: '5e année – M. Gagnon',
        roomId: ROOM_104,
        role: 'subject',
        grades: [{ code: '5', ordinal: 5, labelFr: '5e année' }],
      },
    ],
    team: [
      { classId: C3, ...TEAM.isabelle, role: 'homeroom' },
      { classId: C3, ...TEAM.paul, role: 'subject' },
      { classId: C5, ...TEAM.marc, role: 'homeroom' },
      { classId: C5, ...TEAM.paul, role: 'subject' },
    ],
    blocks: blocks(),
    units: units(),
    progress: [
      ...completed('fra3', 3),
      ...completed('mat3', 4),
      ...completed('mat5', 5),
      ...completed('sci5', 2),
    ],
    students: students(),
    profiles: [
      ...(base.profiles ?? []),
      {
        classId: C5,
        arrivalNotes: null,
        routinesNotes: null,
        classroomManagementNotes: null,
        dismissalNotes: null,
        fallbackActivities: null,
        neighbourNote: null,
        neighbour: { displayName: TEAM.isabelle.displayName, honorific: TEAM.isabelle.honorific },
      },
    ],
  };
}

/** Isabelle as homeroom teacher of both classes (to test two classes at once). */
export function twoClassSources(): RawSources {
  const paul = paulSources();
  return {
    ...paul,
    teacher: { id: ISABELLE, displayName: 'Isabelle Tremblay', honorific: 'Mme' },
    classes: paul.classes!.map((c) => ({ ...c, role: 'homeroom' as const })),
    team: [
      { classId: C3, ...TEAM.isabelle, role: 'homeroom' },
      { classId: C5, ...TEAM.isabelle, role: 'homeroom' },
    ],
  };
}

export function parse(raw: RawSources): SubPlanSources {
  return subPlanSourcesSchema.parse(raw);
}

export const NOW = new Date('2026-10-19T10:00:00.000Z');

// ---------------------------------------------------------------------------------------
// The demo library (content/library/demo/items), as app.sub_plan_library_sources returns it.
// ---------------------------------------------------------------------------------------

const DEMO_ITEMS = new URL('../../../../content/library/demo/items/', import.meta.url);

export interface RawLibraryItem {
  id: string;
  type: string;
  title: string;
  status: string;
  subFriendly: boolean;
  durationMinutes: number | null;
  materials: string | null;
  safetyNotes: unknown;
  catholicConnection: string | null;
  catholicReferenceTitle: string | null;
  faithOnStudentSheet: boolean;
  subjectCode: string | null;
  usageCount: number;
  hasAnswerKey: boolean;
  versions: { levelId: string | null; schemaVersion: number; content: unknown }[];
}

/** The id of a demo resource (UUIDv5 of `demo/<slug>`, as the seed writes it). */
export const demoItemId = (slug: string) => seedItemId('demo', slug);

/**
 * A demo resource from its seed file, with the versions for `levels` (level codes of the
 * fixture's LEVEL; every level by default) and no answer key, as the loader sends it.
 */
export function demoLibraryItem(
  slug: string,
  options: { levels?: readonly (keyof typeof LEVEL)[] } = {},
): RawLibraryItem {
  const item = seedItemSchema.parse(
    JSON.parse(readFileSync(new URL(`${slug}.json`, DEMO_ITEMS), 'utf8')),
  );
  const levels = new Set(options.levels ?? (Object.keys(LEVEL) as (keyof typeof LEVEL)[]));
  return {
    id: demoItemId(slug),
    type: item.type,
    title: item.title,
    status: item.status,
    subFriendly: item.subFriendly,
    durationMinutes: item.durationMinutes,
    materials: item.materials,
    safetyNotes: item.safetyNotes,
    catholicConnection: item.catholicConnection || null,
    catholicReferenceTitle: item.catholicReference,
    faithOnStudentSheet: item.faithOnStudentSheet,
    subjectCode: item.subjectCode,
    usageCount: 0,
    hasAnswerKey: item.versions.some((v) => !!v.answerKey),
    versions: item.versions
      .filter((v) => !v.level || levels.has(v.level as keyof typeof LEVEL))
      .map((v) => ({
        levelId: v.level ? LEVEL[v.level as keyof typeof LEVEL] : null,
        schemaVersion: 1,
        content: v.content,
      })),
  };
}

/**
 * Isabelle's library sources: « Le huard, oiseau des lacs » and the lesson plan « Trouver l'idée
 * principale d'un paragraphe » for the Français lesson 4 (C1.2); her Mathématiques lesson 5
 * links « Ordonner des nombres jusqu'à 1 000 ».
 */
export function isabelleLibrary() {
  return {
    lessonCandidates: [
      {
        lessonId: lesson('fra3', 4),
        candidates: [
          { itemId: demoItemId('huard-oiseau-des-lacs'), reason: 'expectation', overlap: 1 },
          { itemId: demoItemId('idee-principale-paragraphe'), reason: 'expectation', overlap: 1 },
        ],
      },
      {
        lessonId: lesson('mat3', 5),
        candidates: [{ itemId: demoItemId('ordonner-nombres-1000'), reason: 'linked', overlap: 1 }],
      },
    ],
    items: [
      demoLibraryItem('huard-oiseau-des-lacs'),
      demoLibraryItem('idee-principale-paragraphe'),
      demoLibraryItem('ordonner-nombres-1000'),
    ],
  };
}
