import { TERMS_CHANGES } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en-CA.json';
import fr from '../../messages/fr-CA.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}

// Argument names ("{count}", "{count, plural, ...}"), not the text of plural branches ("one {# élève}").
const placeholders = (s: string) =>
  [...s.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{(\w+)\s*[,}]/g)]
    .map((m) => m[1])
    .sort();

describe('translations', () => {
  const frKeys = flatten(fr as Tree);
  const enKeys = flatten(en as Tree);

  it('English has exactly the same keys as French', () => {
    expect([...enKeys.keys()].sort()).toEqual([...frKeys.keys()].sort());
  });

  it('English uses the same placeholders as French', () => {
    for (const [key, value] of frKeys) {
      expect(placeholders(enKeys.get(key) ?? ''), key).toEqual(placeholders(value));
    }
  });
});

describe('typography (Phase 6 review)', () => {
  const frKeys = flatten(fr as Tree);

  it('French never breaks a line inside « » or before its punctuation', () => {
    // tools/i18n/typography.mjs: a no-break space inside « » and before « : », a narrow one
    // before « ; », none before ? and !.
    for (const [key, value] of frKeys) {
      expect(value, key).not.toMatch(/« | »| [:;!?]/);
      expect(value, key).not.toMatch(/[ \u00a0\u202f][!?]/);
      expect(value, key).not.toMatch(/[^\u00a0]:\s|[^\u00a0\s]»|«[^\u00a0]/);
    }
  });

  it('English uses curly quotes and apostrophes in « Conseil » as everywhere else', () => {
    for (const [key, value] of flatten((en as Tree).board as Tree, 'board.')) {
      expect(value, key).not.toMatch(/['"]/);
    }
  });
});

describe('« Nouveautés » and the terms (Phase 6 review)', () => {
  const MONTHS = {
    fr: [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ],
    en: [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ],
  };

  it('dates no release after the month it is built in', () => {
    const now = new Date();
    const current = now.getFullYear() * 12 + now.getMonth();
    for (const [lang, tree] of [
      ['fr', fr],
      ['en', en],
    ] as const) {
      const versions = (
        tree as unknown as {
          releaseNotes: { versions: Record<string, { date: string }> };
        }
      ).releaseNotes.versions;
      for (const [key, { date }] of Object.entries(versions)) {
        const [month, year] = date.toLowerCase().split(' ');
        const index = MONTHS[lang].indexOf(month ?? '');
        expect(index, `${lang} ${key}: ${date}`).toBeGreaterThanOrEqual(0);
        expect(Number(year) * 12 + index, `${lang} ${key}: ${date}`).toBeLessThanOrEqual(current);
      }
    }
  });

  it('says what changed for every version of the terms, in both languages', () => {
    for (const key of Object.values(TERMS_CHANGES)) {
      expect(flatten(fr as Tree).get(`welcome.changes.${key}`), key).toBeTruthy();
      expect(flatten(en as Tree).get(`welcome.changes.${key}`), key).toBeTruthy();
    }
  });
});
