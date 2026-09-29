import { LIBRARY_ITEM_TYPES, sampleCanonical, type RenderedDoc } from '@lynx/content';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { studentVersionDocs } from '../../server/library/item-docs';
import { DocView } from './doc-view';

const KEY_SENTINEL = 'SENTINELLE-CORRIGE';

const html = (doc: RenderedDoc, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(DocView, { doc, ...props }));

function studentDoc(type: (typeof LIBRARY_ITEM_TYPES)[number], number = 1) {
  const { content } = sampleCanonical(type);
  return studentVersionDocs(
    { type, title: 'Titre de la ressource', faith: { connection: null, onStudentSheet: false } },
    { number, content },
  ).student;
}

describe('documents drawn as HTML', () => {
  it('draws the student sheet of every type in French, with no key', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const doc = studentDoc(type);
      if (!doc) continue; // teacher-only types
      const markup = html(doc);
      expect(markup, type).toMatch(/^<article lang="fr-CA"/);
      expect(markup, type).not.toContain(KEY_SENTINEL);
      expect(markup, type).not.toContain('Corrigé');
    }
  });

  it('marks the English half of a family guide as English', () => {
    const markup = html(studentDoc('parent_guide')!);
    expect(markup).toContain('<section lang="en-CA"');
    expect(markup).toContain('<section lang="fr-CA"');
  });

  it('prints the small number only on sheets, never a level name', () => {
    const doc = studentDoc('quiz', 3)!;
    expect(html(doc)).not.toContain('data-testid="sheet-number"');
    const sheet = html(doc, { variant: 'sheet', showNumber: true });
    expect(sheet).toContain('data-testid="sheet-number">3</p>');
    expect(sheet).not.toMatch(/Débutant|Intermédiaire|Avancé|Enrichi/);
  });

  it('draws every question kind with boxes and writing lines, not glyphs', () => {
    const markup = html(studentDoc('quiz')!);
    expect(markup).toContain('Vrai');
    expect(markup).toContain('Faux');
    expect(markup).toContain('Associe chaque élément de gauche à un élément de droite.');
    expect(markup).toContain('Numérote les éléments dans le bon ordre.');
    expect(markup).toContain('border-b border-slate-400'); // writing lines
    expect(markup).not.toMatch(/[☐□■]/);
  });

  it('nests headings under the document title', () => {
    const markup = html(studentDoc('reading_passage')!, { titleLevel: 2 });
    expect(markup).toContain('<h2');
    expect(markup).not.toContain('<h1');
    // Sections of the document sit one level below its title.
    expect(markup).toMatch(/<h3[^>]*>Glossaire<\/h3>/);
  });

  it('draws a rubric as a table with a caption that scrolls on its own', () => {
    const markup = html(studentDoc('rubric')!);
    expect(markup).toMatch(
      /<div class="overflow-x-auto" tabindex="0" role="region" aria-label="[^"]+"><table/,
    );
    expect(markup).toContain('<caption');
    expect(markup).toContain('scope="row"');
  });
});
