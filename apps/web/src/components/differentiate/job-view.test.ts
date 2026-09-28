import { describe, expect, it } from 'vitest';
import { formatMoment, jobEditorVersions } from './job-view';

const version = (level: string) => ({
  level,
  title: 'Le castor',
  text: 'Texte',
  glossary: [],
  visualSupports: [],
  questions: [],
  teacherNote: '',
});

describe('a finished request on its page', () => {
  const input = {
    levels: [
      { key: 'L1', languageLevelId: 'deb', label: 'Débutant', description: null },
      { key: 'L2', languageLevelId: 'gone', label: 'Accueil', description: null },
    ],
  };

  it('names levels in the interface language, falling back to the stored French name', () => {
    const versions = jobEditorVersions(
      input,
      { versions: [version('L1'), version('L2'), version('L9')] },
      new Map([['deb', 'Beginner']]),
    );
    expect(versions.map((v) => [v.languageLevelId, v.levelLabel])).toEqual([
      ['deb', 'Beginner'],
      ['gone', 'Accueil'],
    ]);
  });
});

describe('request times', () => {
  // 15:45 in Ontario is 19:45 UTC: the server's clock (UTC) must not show.
  const at = '2026-09-28T19:45:00Z';

  it('shows the school’s local time', () => {
    expect(formatMoment(at, 'fr-CA')).toBe('28 sept. 2026, 15 h 45');
    expect(formatMoment(at, 'en-CA')).toMatch(/^Sep 28, 2026, 3:45\sp\.m\.$/);
    expect(formatMoment(at, 'fr-CA', 'America/Winnipeg')).toBe('28 sept. 2026, 14 h 45');
  });
});
