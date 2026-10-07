import { describe, expect, it } from 'vitest';
import { selectPromptSections } from './prompts';

const PROMPT = [
  'Commun, au début.',
  '',
  '<!-- section: type:quiz -->',
  '## Type : Quiz',
  'Des questions.',
  '<!-- end section -->',
  '',
  '<!-- section: type:song -->',
  '## Type : Chanson',
  'Des couplets.',
  '<!-- end section -->',
  '',
  'Commun, à la fin.',
].join('\n');

describe('selectPromptSections', () => {
  it('keeps the common part and only the sections asked for, without their markers', () => {
    expect(selectPromptSections(PROMPT, ['type:quiz'])).toBe(
      'Commun, au début.\n\n## Type : Quiz\nDes questions.\n\nCommun, à la fin.',
    );
    expect(selectPromptSections(PROMPT, ['type:song', 'type:quiz'])).toContain('Des couplets.');
    expect(selectPromptSections(PROMPT, [])).toBe('Commun, au début.\n\nCommun, à la fin.');
    expect(selectPromptSections(PROMPT, ['type:unknown'])).not.toContain('section');
  });

  it('leaves a prompt without sections as it is', () => {
    expect(selectPromptSections('Un prompt sans section.', ['type:quiz'])).toBe(
      'Un prompt sans section.',
    );
  });
});
