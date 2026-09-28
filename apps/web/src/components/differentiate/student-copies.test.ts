import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudentCopies } from './student-copies';

const version = {
  languageLevelId: '00000000-0000-4000-8000-000000000001',
  levelLabel: 'Beginner',
  title: 'Le castor',
  text: 'Le castor construit un barrage.',
  glossary: 'castor : animal qui construit des barrages',
  visualSupports: 'Une image',
  questions: 'Où vit le castor ?',
  teacherNote: 'Note',
};

describe('printed student copies', () => {
  const html = renderToStaticMarkup(
    createElement(StudentCopies, { versions: [version], printing: [0] }),
  );

  it('are in French, the language of the content, whatever the interface language', () => {
    expect(html).toContain('lang="fr-CA"');
    expect(html).toContain('>Glossaire<');
    expect(html).toContain('>Questions<');
    expect(html).not.toContain('Glossary');
  });

  it('show only a neutral number, never the level name or the teacher’s note', () => {
    expect(html).toContain('>1<');
    expect(html).not.toContain('Beginner');
    expect(html).not.toContain('Note');
    expect(html).not.toContain('Une image');
  });
});
