/**
 * Achievement-chart wording for rubrics (SPEC 9.3). The qualifiers follow the Ontario
 * achievement chart in French; they are to be checked against the official chart before the
 * pilot (DECISIONS D-030).
 */
import type { AchievementCategory } from './questions';

export type RubricLevel = 1 | 2 | 3 | 4;

/** Qualifier of each level (1 to 4), by category. */
export const ACHIEVEMENT_QUALIFIERS: Record<
  AchievementCategory,
  readonly [string, string, string, string]
> = {
  connaissance: ['limitée', 'partielle', 'générale', 'approfondie'],
  habiletes: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec efficacité',
    'avec beaucoup d’efficacité',
  ],
  communication: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec efficacité',
    'avec beaucoup d’efficacité',
  ],
  application: [
    'avec une efficacité limitée',
    'avec une certaine efficacité',
    'avec efficacité',
    'avec beaucoup d’efficacité',
  ],
};

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’`´]/g, "'");

// Connaissance: the adjectives agree with what they describe (« connaissances limitées »).
const KNOWLEDGE: readonly [RegExp, RegExp, RegExp, RegExp] = [
  /(?<!\p{L})limitee?s?(?!\p{L})/u,
  /(?<!\p{L})partiel(?:le)?s?(?!\p{L})/u,
  /(?<!\p{L})genera(?:l|le|ux|les)(?!\p{L})/u,
  /(?<!\p{L})approfondie?s?(?!\p{L})/u,
];
// The other categories: « efficacité » alone is level 3, so it is looked for once the other
// levels' phrases are removed.
const EFFECTIVENESS_OTHERS: readonly (readonly [RubricLevel, string])[] = [
  [1, 'efficacite limitee'],
  [2, 'certaine efficacite'],
  [4, "beaucoup d'efficacite"],
];

/** The levels whose qualifier appears in a text. */
export function qualifierLevels(category: AchievementCategory, text: string): RubricLevel[] {
  const folded = fold(text);
  if (category === 'connaissance') {
    return ([1, 2, 3, 4] as const).filter((level) => KNOWLEDGE[level - 1]!.test(folded));
  }
  const levels: RubricLevel[] = [];
  let rest = folded;
  for (const [level, phrase] of EFFECTIVENESS_OTHERS) {
    if (rest.includes(phrase)) levels.push(level);
    rest = rest.replaceAll(phrase, ' ');
  }
  if (/(?<!\p{L})efficacite(?!\p{L})/u.test(rest)) levels.push(3);
  return levels.sort((a, b) => a - b);
}

export interface RubricWordingProblem {
  criterionIndex: number;
  level: RubricLevel;
  code: 'missingQualifier' | 'otherLevelQualifier';
  /** For `otherLevelQualifier`: the level whose qualifier was found. */
  foundLevel?: RubricLevel;
}

interface RubricLike {
  criteria: {
    category: AchievementCategory | string;
    levels: { level1: string; level2: string; level3: string; level4: string };
  }[];
}

/** Each level must use its own qualifier and no other level's. */
export function rubricWordingProblems(content: RubricLike): RubricWordingProblem[] {
  const problems: RubricWordingProblem[] = [];
  content.criteria.forEach((criterion, criterionIndex) => {
    if (!(criterion.category in ACHIEVEMENT_QUALIFIERS)) return;
    const category = criterion.category as AchievementCategory;
    const texts = [
      criterion.levels.level1,
      criterion.levels.level2,
      criterion.levels.level3,
      criterion.levels.level4,
    ];
    texts.forEach((text, i) => {
      const level = (i + 1) as RubricLevel;
      const found = qualifierLevels(category, text);
      if (!found.includes(level))
        problems.push({ criterionIndex, level, code: 'missingQualifier' });
      for (const other of found) {
        if (other !== level) {
          problems.push({ criterionIndex, level, code: 'otherLevelQualifier', foundLevel: other });
        }
      }
    });
  });
  return problems;
}
