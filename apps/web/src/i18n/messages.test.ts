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
