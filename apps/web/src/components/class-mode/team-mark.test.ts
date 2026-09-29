import { CLASS_TEAMS } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { CLASS_TEAM_KEYS } from '../../server/class-portal/schemas';
import { ANSWER_LETTERS, TEAM_ORDER, TEAM_STYLES, answerLetter, answerStyle } from './team-mark';

describe('class teams (D-088, D-090)', () => {
  it('follows CLASS_TEAMS: keys, shapes and colour tokens in order', () => {
    expect(TEAM_ORDER).toEqual(CLASS_TEAMS.map((team) => team.key));
    expect(CLASS_TEAM_KEYS).toEqual(CLASS_TEAMS.map((team) => team.key));
    TEAM_STYLES.forEach((style, i) => {
      const team = CLASS_TEAMS[i]!;
      expect(style.shape).toBe(team.shape);
      for (const cls of [style.bg, style.text, style.fill, style.border]) {
        expect(cls).toMatch(new RegExp(`-${team.colorToken}$`));
      }
    });
  });

  it('names every team, and only those, in both catalogues', () => {
    const keys = CLASS_TEAMS.map((team) => team.key).sort();
    for (const messages of [fr, en]) {
      expect(Object.keys(messages.classMode.teams).sort()).toEqual(keys);
      expect(Object.keys(messages.classPortal.teams).sort()).toEqual(keys);
    }
    // Devices and the projector call a team by the same name.
    expect(fr.classPortal.teams).toEqual(fr.classMode.teams);
  });

  it('marks up to 8 answer choices with a letter, a colour and a shape', () => {
    expect(ANSWER_LETTERS).toHaveLength(8);
    expect(answerLetter(0)).toBe('A');
    expect(answerLetter(7)).toBe('H');
    expect(answerStyle(0)).toBe(TEAM_STYLES[0]);
    expect(answerStyle(6)).toBe(TEAM_STYLES[0]);
  });
});
