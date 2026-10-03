import { describe, expect, it } from 'vitest';
import { qualifierLevels, rubricWordingProblems } from './rubric';
import { sampleCanonical } from './samples';
import {
  frenchStrings,
  frenchStyleProblems,
  guillemets,
  NBSP,
  normalizeFrenchTypography,
  suggestsFaithContent,
} from './style';

const codes = (text: string) => frenchStyleProblems(text).map((p) => p.code);

describe('style', () => {
  it('46. flags each style problem', () => {
    expect(codes("L'idée")).toEqual(['straightApostrophe']);
    expect(codes('En 3ème année')).toEqual(['ordinal']);
    expect(codes('La 1ère fois')).toEqual(['ordinal']);
    expect(codes('En CE2 et en CM1')).toEqual(['europeanGrade', 'europeanGrade']);
    expect(codes('Bon week-end!')).toEqual(['notCanadian']);
    expect(codes('Envoie un Email')).toEqual(['notCanadian']);
    expect(codes('«texte»')).toEqual(['guillemetSpacing', 'guillemetSpacing']);
    expect(codes('« texte »')).toEqual(['guillemetSpacing', 'guillemetSpacing']);
    expect(codes('Consigne: lis.')).toEqual(['colonSpacing']);
    // Canadian usage passes.
    expect(codes(`En 3e année, la 1re fois, ${guillemets('texte')}, la fin de semaine.`)).toEqual(
      [],
    );
    expect(codes(`Consigne${NBSP}: lis à 8:45.`)).toEqual([]);
    // Normalizing fixes everything but the words.
    const fixed = normalizeFrenchTypography("L'élève de 3ème: «oui» en CE1");
    expect(codes(fixed)).toEqual(['europeanGrade']);
    expect(normalizeFrenchTypography(fixed)).toBe(fixed);
  });

  it('46. frenchStrings skips machine values and the English half of a family guide', () => {
    const guide = sampleCanonical('parent_guide').content;
    const strings = frenchStrings('parent_guide', guide);
    expect(strings).toContain(guide.fr.intro);
    expect(strings).not.toContain(guide.en.intro);
    const quiz = frenchStrings('quiz', sampleCanonical('quiz').content);
    expect(quiz).not.toContain('multiple_choice');
    expect(quiz).not.toContain('mc1');
    expect(quiz).toContain('Quel nombre est le plus grand?');
  });

  it('46. suggestsFaithContent catches « prière » and not « pierre »', () => {
    expect(suggestsFaithContent('Une courte prière avant de manger.')).toBe(true);
    expect(suggestsFaithContent('Une pierre au bord du lac.')).toBe(false);
    expect(suggestsFaithContent('Pendant l’Avent, nous attendons Noël.')).toBe(true);
    expect(suggestsFaithContent('Le bateau remonte le Saint-Laurent.')).toBe(false);
    expect(suggestsFaithContent('La vie de sainte Marguerite d’Youville.')).toBe(true);
    expect(suggestsFaithContent('Les nouveaux mariés sourient.')).toBe(false);
    expect(suggestsFaithContent('Anne-Marie joue au soccer.')).toBe(false);
    expect(suggestsFaithContent('Jésus-Christ')).toBe(true);
  });
});

describe('rubric', () => {
  it('47. flags a level whose qualifier is missing or belongs to another level', () => {
    const { content } = sampleCanonical('rubric');
    expect(rubricWordingProblems(content)).toEqual([]);

    const swapped = {
      criteria: content.criteria.map((c, i) =>
        i === 1
          ? {
              ...c,
              levels: {
                ...c.levels,
                level3: 'Organise ses idées avec beaucoup d’efficacité.',
                level4: 'Organise ses idées de façon claire.',
              },
            }
          : c,
      ),
    };
    expect(rubricWordingProblems(swapped)).toEqual([
      { criterionIndex: 1, level: 3, code: 'missingQualifier' },
      { criterionIndex: 1, level: 3, code: 'otherLevelQualifier', foundLevel: 4 },
      { criterionIndex: 1, level: 4, code: 'missingQualifier' },
    ]);

    const knowledge = {
      criteria: [
        {
          category: 'connaissance',
          levels: {
            level1: 'Connaissances limitées.',
            level2: 'Connaissance générale.',
            level3: 'Compréhension générale.',
            level4: 'Connaissance approfondie.',
          },
        },
      ],
    };
    expect(rubricWordingProblems(knowledge)).toEqual([
      { criterionIndex: 0, level: 2, code: 'missingQualifier' },
      { criterionIndex: 0, level: 2, code: 'otherLevelQualifier', foundLevel: 3 },
    ]);
  });

  it('tells « efficacité » alone (level 3) from the other levels', () => {
    expect(qualifierLevels('habiletes', 'avec efficacité')).toEqual([3]);
    expect(qualifierLevels('habiletes', 'avec une certaine efficacité')).toEqual([2]);
    expect(qualifierLevels('habiletes', 'avec beaucoup d’efficacité')).toEqual([4]);
    expect(qualifierLevels('habiletes', 'avec une efficacité limitée')).toEqual([1]);
    expect(qualifierLevels('habiletes', 'sans lien')).toEqual([]);
  });
});
