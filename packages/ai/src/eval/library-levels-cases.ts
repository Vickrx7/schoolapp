/**
 * Evaluation set for « Créer les versions manquantes avec l’IA » (library_levels, DECISIONS
 * D-073): ten base versions, one per kind of resource worth checking, as the database sends them
 * (the samples of @lynx/content: original, fictional content). Case 3 asks for the two most
 * demanding levels only, so no level is the most accessible one.
 *
 *   pnpm ai:eval --feature library_levels --provider fake
 *   pnpm ai:eval --feature library_levels --case quiz-avance-enrichi --yes
 */
import { sampleCanonical, type LibraryItemType } from '@lynx/content';
import type { LibraryLevelsInput } from '../features/library-levels';
import type { KnownPerson } from '../privacy';
import { EVAL_LEVELS } from './library-item-cases';

export interface LibraryLevelsCase {
  id: string;
  title: string;
  /** As `app.library_levels_ai_input` returns it (character names are added per request). */
  input: Omit<LibraryLevelsInput, 'characterNames'>;
  people?: KnownPerson[];
}

let n = 0;

function levelsCase(
  id: string,
  title: string,
  type: LibraryItemType,
  context: { grade: string; subject: string; objective: string },
  levelKeys: readonly string[] = ['L1', 'L2', 'L3', 'L4'],
): LibraryLevelsCase {
  n += 1;
  const { content, answerKey } = sampleCanonical(type, { objective: context.objective });
  return {
    id,
    title,
    input: {
      itemId: `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      baseRevision: 3,
      itemType: type,
      gradeLabels: [context.grade],
      subjectLabel: context.subject,
      // Keys follow the order sent (L1…), like the database's.
      levels: EVAL_LEVELS.filter((l) => levelKeys.includes(l.key)).map((l, i) => ({
        ...l,
        key: `L${i + 1}`,
      })),
      base: {
        content: content as Record<string, unknown>,
        answerKey: answerKey as unknown as Record<string, unknown> | null,
      },
    },
  };
}

const numbers3 = {
  grade: '3e année',
  subject: 'Mathématiques',
  objective: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
};
const reading3 = {
  grade: '3e année',
  subject: 'Français',
  objective: 'Repérer l’idée principale et quelques détails importants d’un texte informatif.',
};
const science5 = {
  grade: '5e année',
  subject: 'Sciences et technologie',
  objective: 'Distinguer les forces internes et externes qui agissent sur une structure.',
};

export const libraryLevelsCases: LibraryLevelsCase[] = [
  levelsCase('lecture-castor', 'Texte de lecture : le castor', 'reading_passage', reading3),
  levelsCase('fiche-comparer', 'Fiche d’exercices : comparer des nombres', 'worksheet', numbers3),
  levelsCase(
    'quiz-avance-enrichi',
    'Quiz : les nombres jusqu’à 1 000 (Avancé et Enrichi seulement)',
    'quiz',
    numbers3,
    ['L3', 'L4'],
  ),
  levelsCase('billet-sortie', 'Billet de sortie : comparer', 'exit_ticket', numbers3),
  levelsCase(
    'banque-mots',
    'Banque de mots : les animaux de la forêt',
    'vocabulary_bank',
    reading3,
  ),
  levelsCase('referentiel', 'Référentiel : trouver l’idée principale', 'anchor_chart', reading3),
  levelsCase(
    'experience-eponge',
    'Expérience : l’éponge et la compression',
    'experiment',
    science5,
  ),
  levelsCase('jeu-nombres', 'Jeu : la bataille des nombres', 'game', numbers3),
  levelsCase('amorce-drapeau', 'Amorce culturelle : le drapeau franco-ontarien', 'culture_hook', {
    grade: '5e année',
    subject: 'Français',
    objective: 'Découvrir un symbole de la francophonie ontarienne.',
  }),
  levelsCase('devinettes', 'Devinettes : qui suis-je?', 'riddle', reading3),
];
