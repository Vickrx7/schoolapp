import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { COVERAGE_FILTERS } from './coverage-view';

/**
 * The « Couverture du curriculum » messages (DECISIONS D-094) format with the values the page
 * passes, in both languages, with French plural agreement (0 and 1 take the singular).
 */
const translators = {
  fr: createTranslator({ locale: 'fr-CA', messages: fr, namespace: 'libraryCoverage' }),
  en: createTranslator({ locale: 'en-CA', messages: en, namespace: 'libraryCoverage' }),
};

describe('libraryCoverage messages', () => {
  it('count the attentes with French agreement', () => {
    const t = translators.fr;
    expect(t('list.covered', { covered: 14, total: 22 })).toBe(
      '14 attentes sur 22 ont au moins une ressource approuvée.',
    );
    expect(t('list.covered', { covered: 1, total: 22 })).toBe(
      '1 attente sur 22 a au moins une ressource approuvée.',
    );
    expect(t('list.covered', { covered: 0, total: 3 })).toBe(
      '0 attente sur 3 a au moins une ressource approuvée.',
    );
    expect(t('status.none')).toBe('Aucune ressource approuvée');
    expect(t('status.few', { count: 1 })).toBe('Peu : 1 ressource approuvée');
    expect(t('status.approved', { count: 3 })).toBe('3 ressources approuvées');
    expect(t('status.overall', { count: 0 })).toBe(
      'Aucune ressource approuvée pour cette attente et ses contenus d’apprentissage',
    );
    expect(t('inReview', { count: 2 })).toBe('2 en révision');
    expect(t('list.enough', { count: 5, min: 2 })).toBe('5 avec au moins 2 ressources approuvées');
    expect(
      t('summary.cellLabel', {
        subject: 'Mathématiques',
        grade: '3e année',
        covered: 11,
        total: 36,
      }),
    ).toBe('Mathématiques, 3e année : 11 attentes sur 36 ont au moins une ressource approuvée');
  });

  it('count the expectations in English', () => {
    const t = translators.en;
    expect(t('list.covered', { covered: 0, total: 3 })).toBe(
      '0 expectations of 3 have at least one approved resource.',
    );
    expect(t('list.covered', { covered: 1, total: 3 })).toBe(
      '1 expectation of 3 has at least one approved resource.',
    );
    expect(t('status.few', { count: 1 })).toBe('Few: 1 approved resource');
  });

  it('format every message with the page’s values in both languages', () => {
    for (const t of Object.values(translators)) {
      const values = {
        covered: 2,
        total: 5,
        count: 1,
        min: 2,
        types: 'Quiz',
        subject: 'S',
        grade: 'G',
      };
      for (const key of [
        'title',
        'intro',
        'hubLink',
        'curriculumLink',
        'summary.title',
        'summary.caption',
        'summary.grade',
        'summary.cell',
        'summary.cellLabel',
        'summary.without',
        'summary.notLoaded',
        'summary.empty',
        'summary.error',
        'list.covered',
        'list.none',
        'list.few',
        'list.enough',
        'list.strandCount',
        'list.strandCountLabel',
        'list.emptyNone',
        'list.emptyFew',
        'list.error',
        'filters.open',
        'filters.title',
        'filters.close',
        'filters.done',
        'filters.showLabel',
        'filters.threshold',
        'filters.thresholdHint',
        ...COVERAGE_FILTERS.map((f) => `filters.show.${f}`),
        'status.none',
        'status.few',
        'status.approved',
        'status.overall',
        'inReview',
        'types',
        'see',
        'create',
        'createAi',
        'howCounted.title',
        'howCounted.direct',
        'howCounted.browse',
        'howCounted.threshold',
        'howCounted.review',
      ] as const) {
        const text = t(key as Parameters<typeof t>[0], values);
        expect(text, key).not.toMatch(/[{}]|libraryCoverage/);
        expect(text.length, key).toBeGreaterThan(0);
      }
    }
  });
});
