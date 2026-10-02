/**
 * « Couverture du curriculum » drawn as HTML (DECISIONS D-094): each attente's level in words
 * (not only colour), « en révision » only where the rows carry it, the links to create what is
 * missing only for attentes without enough resources, and the overview's cells with the one being
 * shown marked.
 */
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '../../../../messages/fr-CA.json';
import {
  buildCoverageSummary,
  groupCoverage,
  type CoverageRow,
  type CoverageStrand,
} from '../../../server/library/coverage-view';
import { CoverageList, type CoverageScope } from './coverage-list';
import { CoverageSummary } from './coverage-summary';

/** The provider's settings; its children are the element drawn. */
const intl = {
  locale: 'fr-CA',
  messages: fr,
  timeZone: 'America/Toronto',
} as ComponentProps<typeof NextIntlClientProvider>;

const html = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, intl, element));

const row = (
  expectationId: string,
  patch: Partial<CoverageRow> & Pick<CoverageRow, 'kind' | 'code'>,
): CoverageRow => ({
  expectationId,
  parentId: null,
  strandId: 'sB',
  text: `Texte de ${patch.code}`,
  verified: true,
  sortOrder: 0,
  hasChildren: false,
  approvedCount: 0,
  inReviewCount: null,
  approvedTypes: [],
  ...patch,
});

const strands: CoverageStrand[] = [{ id: 'sB', code: 'B', label: 'Nombres', sortOrder: 1 }];
const rows: CoverageRow[] = [
  row('b1', { kind: 'overall', code: 'B1', hasChildren: true, approvedCount: 4, sortOrder: 1 }),
  row('b11', {
    kind: 'specific',
    code: 'B1.1',
    parentId: 'b1',
    sortOrder: 1,
    approvedCount: 3,
    approvedTypes: ['quiz', 'worksheet'],
  }),
  row('b12', { kind: 'specific', code: 'B1.2', parentId: 'b1', sortOrder: 2, verified: false }),
  row('b13', { kind: 'specific', code: 'B1.3', parentId: 'b1', sortOrder: 3, approvedCount: 1 }),
];
const scope: CoverageScope = {
  gradeCode: '3',
  subjectId: 'subject-mat',
  canCreate: true,
  canGenerate: false,
};

/** The HTML of one attente's list item, by its code. */
function itemOf(markup: string, code: string): string {
  // Split at each list item (`<li>` or `<li class…>`, not an icon's `<line>`).
  const items = markup.split(/<li(?=[\s>])/).filter((part) => part.includes(`>${code}</span>`));
  expect(items.length, code).toBeGreaterThan(0);
  return items.at(-1)!;
}

describe('CoverageList', () => {
  const markup = html(
    createElement(CoverageList, { view: groupCoverage(rows, strands, { min: 2 }), scope }),
  );

  it('names each level in words', () => {
    expect(itemOf(markup, 'B1.1')).toContain('3 ressources approuvées');
    expect(itemOf(markup, 'B1.2')).toContain('Aucune ressource approuvée');
    expect(itemOf(markup, 'B1.3')).toContain('Peu\u00a0: 1 ressource approuvée');
    expect(markup).toContain(
      '4 ressources approuvées pour cette attente et ses contenus d’apprentissage',
    );
    expect(markup).toContain('Domaine B — Nombres');
    expect(itemOf(markup, 'B1.1')).toContain('Types\u00a0: Quiz, Fiche d’exercices');
    expect(itemOf(markup, 'B1.2')).toContain('À vérifier');
  });

  it('offers to create only where resources are missing, naming the attente', () => {
    expect(itemOf(markup, 'B1.1')).not.toContain('Créer une ressource');
    expect(itemOf(markup, 'B1.2')).toContain(
      'href="/library/new?grade=3&amp;subject=subject-mat&amp;exp=b12"',
    );
    expect(itemOf(markup, 'B1.2')).toContain('<span class="sr-only"> (B1.2)</span>');
    expect(itemOf(markup, 'B1.3')).toContain('Créer une ressource');
    // AI is off here, and « Voir les ressources approuvées » needs approved resources.
    expect(markup).not.toContain('Créer avec l’IA');
    expect(itemOf(markup, 'B1.2')).not.toContain('Voir les ressources approuvées');
    expect(itemOf(markup, 'B1.1')).toContain('Voir les ressources approuvées');
    expect(itemOf(markup, 'B1.1')).toContain('approved=1');
  });

  it('shows « en révision » only where the rows carry it', () => {
    expect(markup).not.toContain('en révision');
    const reviewer = html(
      createElement(CoverageList, {
        view: groupCoverage(
          rows.map((r) => ({ ...r, inReviewCount: r.code === 'B1.2' ? 2 : 0 })),
          strands,
        ),
        scope: { ...scope, canCreate: false, canGenerate: true },
      }),
    );
    expect(itemOf(reviewer, 'B1.2')).toContain('2 en révision');
    expect(itemOf(reviewer, 'B1.1')).not.toContain('en révision');
    expect(itemOf(reviewer, 'B1.2')).not.toContain('Créer une ressource');
    expect(itemOf(reviewer, 'B1.2')).toContain('href="/library/generate?exp=b12"');
  });
});

describe('CoverageSummary', () => {
  const options = {
    grades: [
      { code: '3', label: '3e année', ordinal: 3 },
      { code: '5', label: '5e année', ordinal: 5 },
    ],
    subjects: [
      { id: 'fra', code: 'fra', label: 'Français', gradeMin: -1, gradeMax: 8 },
      { id: 'mat', code: 'mat', label: 'Mathématiques', gradeMin: -1, gradeMax: 8 },
    ],
    anglaisStartGrade: 4,
  };
  const summary = buildCoverageSummary(
    [
      { gradeCode: '3', subjectId: 'mat', units: 36, none: 25, few: 8, covered: 3 },
      { gradeCode: '3', subjectId: 'fra', units: 32, none: 32, few: 0, covered: 0 },
      { gradeCode: '5', subjectId: 'mat', units: 35, none: 0, few: 14, covered: 21 },
    ],
    options,
  );
  const markup = html(
    createElement(CoverageSummary, {
      summary,
      current: { grade: '3', subject: 'mat' },
      show: 'none',
      min: 3,
    }),
  );

  it('is a table with a caption, headers and a cell per grade and subject', () => {
    expect(markup).toContain('<caption id="coverage-summary-caption"');
    expect(markup).toContain('<th scope="col"');
    expect(markup).toContain('<th scope="row"');
    expect(markup).toContain('>11 sur 36<');
    expect(markup).toContain('>25 sans ressource<');
    expect(markup).toContain(
      'Mathématiques, 3e année\u00a0: 11 attentes sur 36 ont au moins une ressource approuvée',
    );
    // 5e année has no Français attentes.
    expect(markup).toContain('Aucune attente chargée');
    // The region scrolls on its own and can be reached with the keyboard.
    expect(markup).toContain('tabindex="0"');
  });

  it('marks the cell being shown and keeps the filters in its links', () => {
    const current = /<a aria-current="page"[^>]*href="([^"]*)"/.exec(markup);
    expect(current?.[1]).toBe('/library/coverage?grade=3&amp;subject=mat&amp;show=none&amp;min=3');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain(
      'href="/library/coverage?grade=5&amp;subject=mat&amp;show=none&amp;min=3"',
    );
  });

  it('says when no attentes are loaded', () => {
    expect(
      html(
        createElement(CoverageSummary, {
          summary: { subjects: [], grades: [] },
          current: { grade: null, subject: null },
          show: 'all',
          min: 2,
        }),
      ),
    ).toContain('Aucune attente n’est encore chargée pour votre conseil.');
  });
});
