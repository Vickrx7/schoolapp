/**
 * Evaluation set for « Consignes détaillées » (SPEC 10: 10 sample inputs with expected qualities,
 * plus one at the largest size the app sends). Fictional classes and lessons written for this
 * purpose, shaped as `buildSubPlanAiInput` (packages/domain) builds them from a plan. Run with
 * `pnpm ai:eval --feature sub_plan` before any prompt change.
 */
import type { SubPlanAiBlockInput, SubPlanAiInput } from '../features/sub-plan';
import type { KnownPerson } from '../privacy';
import type { SubPlanExpectations } from './checks';

export interface SubPlanCase {
  id: string;
  /** What the case is about, for the report. */
  title: string;
  input: SubPlanAiInput;
  /** People in the case's imaginary school, to check de-identification. */
  people?: KnownPerson[];
  expect: SubPlanExpectations;
}

/** A fixed, fictional uuid for block and lesson references (never sent). */
const ref = (kind: 'b' | 'l', n: number) =>
  `00000000-0000-4000-8000-${kind === 'b' ? 'b' : 'c'}${String(n).padStart(11, '0')}`;

const LEVELS = {
  debutant: {
    levelLabel: 'Débutant',
    levelDescription:
      'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.',
  },
  intermediaire: {
    levelLabel: 'Intermédiaire',
    levelDescription: 'Phrases simples et vocabulaire courant, quelques mots nouveaux expliqués.',
  },
  avance: { levelLabel: 'Avancé', levelDescription: 'Texte du niveau scolaire attendu.' },
  enrichi: {
    levelLabel: 'Enrichi',
    levelDescription: 'Vocabulaire plus riche et questions d’approfondissement.',
  },
} as const;
type Level = keyof typeof LEVELS;

/** Groups G<first>... for one class, in level order. */
function groups(sizes: [Level, number][], first = 1): SubPlanAiInput['groups'] {
  return sizes.map(([level, size], i) => ({ key: `G${first + i}`, ...LEVELS[level], size }));
}

const keys = (g: SubPlanAiInput['groups']) => g.map((x) => x.key);

/** A block with defaults: normal status, no event, no fallback, no activity asked. */
function block(
  n: number,
  fields: Partial<SubPlanAiBlockInput> &
    Pick<SubPlanAiBlockInput, 'start' | 'end' | 'minutes' | 'subjectLabel' | 'groups'>,
): SubPlanAiBlockInput {
  const lesson = fields.lesson ?? null;
  return {
    key: `B${n}`,
    ref: { blockKey: ref('b', n), lessonId: lesson ? ref('l', n) : null },
    status: 'normal',
    eventTitle: null,
    unitTitle: null,
    room: 'Local 101',
    lesson,
    fallback: null,
    needsActivity: lesson === null,
    ...fields,
  };
}

const THIRD = groups([
  ['debutant', 3],
  ['intermediaire', 4],
  ['avance', 10],
  ['enrichi', 3],
]);

const FAITH_RESPECT = {
  ref: '00000000-0000-4000-8000-f00000000001',
  title: 'Le respect',
  text: 'Je traite les autres comme j’aimerais être traité, en paroles et en gestes.',
};

/** About 3,000 characters of a detailed lesson, for the largest request. */
function longLesson(topic: string, steps: string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (parts.join(' ').length < 3000) {
    const step = steps[i % steps.length]!;
    parts.push(`Étape ${i + 1} : ${step} (${topic}).`);
    i++;
  }
  return parts.join(' ').slice(0, 3000);
}

const LONG_STEPS = [
  'Rappelez aux élèves ce qui a été vu à la dernière période et notez deux mots clés au tableau',
  'Lisez la consigne à voix haute, puis demandez à un ou une volontaire de la reformuler',
  'Modélisez un premier exemple en pensant à voix haute et en montrant chaque geste',
  'Faites travailler les élèves en dyades pendant que vous circulez avec la liste de la classe',
  'Arrêtez la classe avec le signal habituel et faites un court partage de deux ou trois réponses',
  'Proposez un deuxième exemple un peu plus difficile et laissez les dyades le résoudre seules',
  'Invitez les élèves qui ont terminé à comparer leur travail avec une autre dyade',
  'Ramassez les feuilles dans le bac de remise et placez-les sur le bureau de l’enseignante',
];

export const subPlanCases: SubPlanCase[] = [
  {
    id: 'francais-maths-assemblee-3e',
    title: '3e année : Français, puis Mathématiques interrompues par une assemblée',
    input: {
      gradeLabels: ['3e année'],
      weekday: 'mercredi',
      groups: THIRD,
      faith: FAITH_RESPECT,
      blocks: [
        block(1, {
          start: '08:55',
          end: '09:45',
          minutes: 50,
          subjectLabel: 'Français',
          unitTitle: 'Lire pour s’informer : les animaux de l’Ontario',
          groups: keys(THIRD),
          lesson: {
            title: 'Trouver l’idée principale',
            objectives: 'Repérer l’idée principale d’un paragraphe.',
            materials: 'Texte « Le huard », organisateur graphique « idée principale et détails ».',
            content:
              'Modéliser avec le premier paragraphe, puis travail en dyades pour les deux suivants. Retour en grand groupe.',
            subNotes:
              'Les élèves au niveau Débutant peuvent travailler avec la version illustrée du texte (bac vert).',
          },
        }),
        block(2, {
          start: '09:45',
          end: '10:35',
          minutes: 25,
          status: 'interrupted',
          eventTitle: 'Assemblée de la Semaine de la sécurité',
          subjectLabel: 'Mathématiques',
          unitTitle: 'Les nombres jusqu’à 1 000',
          groups: keys(THIRD),
          lesson: {
            title: 'Ordonner des nombres',
            objectives: 'Ordonner des nombres en ordre croissant et décroissant.',
            materials: 'Cartes-nombres, fiche d’exercices.',
            content: 'Travail en équipes de trois, puis fiche individuelle.',
            subNotes: 'La fiche d’exercices est dans le cartable rouge sur le bureau.',
          },
        }),
      ],
    },
    expect: { mustKeep: ['idée principale', 'ordre croissant', 'cartable rouge'] },
  },
  {
    id: 'sciences-elastiques-5e',
    title: '5e année : Sciences avec une consigne de sécurité',
    input: {
      gradeLabels: ['5e année'],
      weekday: 'jeudi',
      groups: groups([
        ['debutant', 3],
        ['intermediaire', 4],
        ['avance', 10],
        ['enrichi', 3],
      ]),
      faith: null,
      blocks: [
        block(1, {
          start: '13:35',
          end: '14:25',
          minutes: 50,
          subjectLabel: 'Sciences et technologie',
          unitTitle: 'Les forces qui agissent sur les structures',
          room: 'Local 104',
          groups: ['G1', 'G2', 'G3', 'G4'],
          lesson: {
            title: 'Compression et tension',
            objectives: 'Observer la compression et la tension.',
            materials: 'Éponges, élastiques.',
            content: 'Expériences simples en dyades.',
            subNotes:
              'Distribuer une éponge et un élastique par dyade; les élèves ne lancent pas les élastiques.',
          },
        }),
      ],
    },
    expect: { mustKeep: ['les élèves ne lancent pas les élastiques'] },
  },
  {
    id: 'apres-midi-sortie-hative-3e',
    title: '3e année, après-midi : sortie hâtive qui écourte la période',
    input: {
      gradeLabels: ['3e année'],
      weekday: 'vendredi',
      groups: THIRD,
      faith: null,
      blocks: [
        block(1, {
          start: '13:35',
          end: '14:05',
          minutes: 30,
          status: 'shortened',
          eventTitle: 'Sortie hâtive',
          subjectLabel: 'Sciences et technologie',
          unitTitle: 'Les plantes autour de nous',
          groups: keys(THIRD),
          lesson: {
            title: 'Les parties d’une plante',
            objectives: 'Nommer les parties d’une plante et leur rôle.',
            materials: 'Affiche d’une plante, plante en pot (rebord de la fenêtre).',
            content:
              'Observer la plante de la classe. Nommer ensemble les racines, la tige, les feuilles et la fleur. Les élèves dessinent la plante et identifient chaque partie.',
            subNotes: null,
          },
        }),
      ],
    },
    expect: {},
  },
  {
    id: 'eps-rotation-deux-classes',
    title: 'Enseignant de rotation en éducation physique : deux classes, sans unité',
    input: {
      gradeLabels: ['3e année', '5e année'],
      weekday: 'mardi',
      groups: [
        ...groups([
          ['debutant', 3],
          ['intermediaire', 4],
          ['avance', 10],
          ['enrichi', 3],
        ]),
        ...groups(
          [
            ['debutant', 3],
            ['intermediaire', 5],
            ['avance', 9],
            ['enrichi', 3],
          ],
          5,
        ),
      ],
      faith: null,
      blocks: [
        block(1, {
          start: '13:35',
          end: '14:25',
          minutes: 50,
          subjectLabel: 'Éducation physique et santé',
          room: 'Gymnase',
          groups: ['G1', 'G2', 'G3', 'G4'],
          fallback:
            'Jeux coopératifs au gymnase : relais en équipes, puis ballon-chasseur avec des balles en mousse.',
        }),
        block(2, {
          start: '14:25',
          end: '15:15',
          minutes: 50,
          subjectLabel: 'Éducation physique et santé',
          room: 'Gymnase',
          groups: ['G5', 'G6', 'G7', 'G8'],
          fallback: 'Parcours d’agilité avec les cerceaux et les cônes, puis étirements au calme.',
        }),
      ],
    },
    expect: { rooms: ['Gymnase'], mustKeep: ['relais', 'cerceaux'] },
  },
  {
    id: 'premiere-annee-sans-foi',
    title: '1re année, sans moment de foi : étapes courtes et pause active',
    input: {
      gradeLabels: ['1re année'],
      weekday: 'lundi',
      groups: groups([
        ['debutant', 6],
        ['intermediaire', 6],
        ['avance', 8],
      ]),
      faith: null,
      blocks: [
        block(1, {
          start: '08:55',
          end: '09:45',
          minutes: 50,
          subjectLabel: 'Français',
          unitTitle: 'Les sons de la langue',
          groups: ['G1', 'G2', 'G3'],
          lesson: {
            title: 'Le son « ou »',
            objectives: 'Reconnaître le son « ou » à l’oral et à l’écrit.',
            materials: 'Cartes-images (bac des sons), ardoises et crayons effaçables.',
            content:
              'Chanter la comptine du son « ou ». Montrer les cartes-images et faire lever la main quand on entend « ou ». Écrire des mots avec « ou » sur l’ardoise.',
            subNotes: null,
          },
        }),
        block(2, {
          start: '09:45',
          end: '10:35',
          minutes: 50,
          subjectLabel: 'Mathématiques',
          unitTitle: 'Les nombres jusqu’à 20',
          groups: ['G1', 'G2', 'G3'],
          lesson: {
            title: 'Compter par bonds de 2',
            objectives: 'Compter par bonds de 2 jusqu’à 20.',
            materials: 'Droite numérique au sol, jetons.',
            content:
              'Sauter sur la droite numérique par bonds de 2. Former des paires de jetons et les compter. Chanter la comptine des nombres pairs.',
            subNotes: null,
          },
        }),
      ],
    },
    expect: {
      maxStepMinutes: 8,
      mustMentionAny: [['bouger', 'pause active', 'étirement', 'mouvement']],
    },
  },
  {
    id: 'histoire-titre-seulement-7e',
    title: '7e année : leçon d’histoire réduite à un titre',
    input: {
      gradeLabels: ['7e année'],
      weekday: 'mercredi',
      groups: groups([
        ['intermediaire', 6],
        ['avance', 14],
        ['enrichi', 4],
      ]),
      faith: FAITH_RESPECT,
      blocks: [
        block(1, {
          start: '11:15',
          end: '12:05',
          minutes: 50,
          subjectLabel: 'Histoire et géographie',
          unitTitle: 'La Nouvelle-France',
          room: 'Local 204',
          groups: ['G1', 'G2', 'G3'],
          lesson: {
            title: 'La Nouvelle-France et la traite des fourrures',
            objectives: null,
            materials: null,
            content: null,
            subNotes: null,
          },
          needsActivity: true,
        }),
      ],
    },
    expect: { mustKeep: ['Nouvelle-France', 'fourrures'] },
  },
  {
    id: 'classe-combinee-3e-4e',
    title: 'Classe combinée 3e et 4e années : une consigne par groupe',
    input: {
      gradeLabels: ['3e année', '4e année'],
      weekday: 'jeudi',
      groups: groups([
        ['debutant', 4],
        ['avance', 14],
        ['enrichi', 5],
      ]),
      faith: {
        ref: '00000000-0000-4000-8000-f00000000002',
        title: 'La persévérance',
        text: 'Quand une tâche est difficile, je continue d’essayer et je demande de l’aide au besoin.',
      },
      blocks: [
        block(1, {
          start: '09:45',
          end: '10:35',
          minutes: 50,
          subjectLabel: 'Mathématiques',
          unitTitle: 'La multiplication',
          groups: ['G1', 'G2', 'G3'],
          lesson: {
            title: 'La multiplication comme addition répétée',
            objectives:
              'Représenter une multiplication par des groupes égaux et par une addition répétée.',
            materials: 'Jetons, gobelets, cahier de mathématiques.',
            content:
              'Former des groupes égaux avec les jetons dans les gobelets. Écrire l’addition répétée, puis la multiplication. Les élèves de 4e année inventent un problème pour un camarade.',
            subNotes: null,
          },
        }),
      ],
    },
    expect: { mustKeep: ['groupes égaux'] },
  },
  {
    id: 'beaucoup-de-debutants-et-enrichi',
    title: '4e année : 40 % de débutants et un groupe enrichi, leçon mince',
    input: {
      gradeLabels: ['4e année'],
      weekday: 'mardi',
      groups: groups([
        ['debutant', 8],
        ['avance', 9],
        ['enrichi', 3],
      ]),
      faith: null,
      blocks: [
        block(1, {
          start: '11:15',
          end: '12:05',
          minutes: 50,
          subjectLabel: 'Études sociales',
          unitTitle: 'Les régions du Canada',
          groups: ['G1', 'G2', 'G3'],
          lesson: {
            title: 'Le Bouclier canadien',
            objectives: null,
            materials: null,
            content: 'Lecture de la page 34 du manuel.',
            subNotes: null,
          },
          needsActivity: true,
        }),
      ],
    },
    expect: { mustKeep: ['Bouclier canadien'] },
  },
  {
    id: 'unite-terminee-activites-de-rechange',
    title: '3e année : unité terminée, les activités de rechange de la classe',
    input: {
      gradeLabels: ['3e année'],
      weekday: 'lundi',
      groups: THIRD,
      faith: FAITH_RESPECT,
      blocks: [
        block(1, {
          start: '14:25',
          end: '15:15',
          minutes: 50,
          subjectLabel: 'Éducation artistique',
          groups: keys(THIRD),
          fallback:
            'Lecture libre (bac jaune), puis dessin de l’animal préféré dans le cahier d’écriture.',
        }),
      ],
    },
    expect: { mustKeep: ['lecture libre', 'bac jaune'] },
  },
  {
    id: 'nom-telephone-avent',
    title: 'Un élève nommé dans la leçon, un téléphone dans une note, la prière de l’Avent',
    people: [
      { name: 'Samuel', kind: 'student' },
      { name: 'Robert Côté', kind: 'staff' },
    ],
    input: {
      gradeLabels: ['2e année'],
      weekday: 'mardi',
      groups: groups([
        ['debutant', 5],
        ['avance', 13],
      ]),
      faith: {
        ref: '00000000-0000-4000-8000-f00000000003',
        title: 'Prière de l’Avent',
        text: 'Seigneur, pendant ce temps d’attente, rends nos cœurs prêts à t’accueillir et à partager avec les autres. Amen.',
      },
      blocks: [
        block(1, {
          start: '09:45',
          end: '10:35',
          minutes: 50,
          subjectLabel: 'Mathématiques',
          unitTitle: 'Additionner et soustraire',
          groups: ['G1', 'G2'],
          lesson: {
            title: 'Le magasin de la classe',
            objectives: 'Additionner des montants jusqu’à 20 ¢.',
            materials: 'Pièces de monnaie en plastique (tiroir du haut), étiquettes de prix.',
            content:
              'Samuel aide à distribuer les pièces de monnaie. Les élèves achètent deux articles et calculent le total. Ils vérifient avec un camarade.',
            subNotes: 'En cas de problème, appelez M. Côté au 613-555-0142.',
          },
        }),
      ],
    },
    expect: {
      namesRestored: ['Samuel'],
      dropped: ['blocks.B1.lesson.subNotes'],
      neverSent: ['613-555-0142', 'Samuel', 'Côté'],
      faithMentions: ['Avent'],
    },
  },
  {
    id: 'plus-grande-demande-10-periodes',
    title: 'La plus grande demande : 10 périodes de 30 minutes avec des leçons de 3 000 caractères',
    input: {
      gradeLabels: ['4e année', '6e année'],
      weekday: 'mercredi',
      groups: [
        ...groups([
          ['debutant', 4],
          ['intermediaire', 5],
          ['avance', 9],
          ['enrichi', 3],
        ]),
        ...groups(
          [
            ['debutant', 3],
            ['avance', 15],
            ['enrichi', 4],
          ],
          5,
        ),
      ],
      faith: FAITH_RESPECT,
      blocks: [
        ['08:55', 'Musique', 'Le rythme et la pulsation'],
        ['09:25', 'Musique', 'Les instruments à percussion'],
        ['10:00', 'Éducation artistique', 'Les couleurs chaudes et froides'],
        ['10:30', 'Éducation artistique', 'Le collage'],
        ['11:15', 'Anglais', 'Daily routines'],
        ['11:45', 'Anglais', 'Asking questions'],
        ['12:55', 'Musique', 'Chanter en canon'],
        ['13:25', 'Musique', 'La nuance forte et douce'],
        ['14:00', 'Éducation artistique', 'La perspective'],
        ['14:30', 'Éducation artistique', 'Le portrait'],
      ].map(([start, subject, title], i) => {
        const [h, m] = start!.split(':').map(Number) as [number, number];
        const endMinutes = h * 60 + m + 30;
        const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
        const sixth = i % 2 === 1;
        return block(i + 1, {
          start: start!,
          end,
          minutes: 30,
          subjectLabel: subject!,
          unitTitle: `${subject} : ${sixth ? '6e' : '4e'} année`,
          room: subject === 'Musique' ? 'Local 110' : 'Local 112',
          groups: sixth ? ['G5', 'G6', 'G7'] : ['G1', 'G2', 'G3', 'G4'],
          lesson: {
            title: title!,
            objectives: `Explorer « ${title} » et réinvestir le vocabulaire de l’unité.`,
            materials: 'Matériel de la classe (armoire du fond), cahiers, crayons de couleur.',
            content: longLesson(title!, LONG_STEPS),
            subNotes: 'Les élèves rangent le matériel cinq minutes avant la fin de la période.',
          },
        });
      }),
    },
    expect: { rooms: ['Local 110', 'Local 112'] },
  },
];
