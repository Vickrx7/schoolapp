#!/usr/bin/env node
// French and English typography of the message catalogues (apps/web/messages), applied in place:
//
//   node tools/i18n/typography.mjs
//
// French (fr-CA.json): a no-break space (U+00A0) inside « » and before the colon, a narrow
// no-break space (U+202F) before the semicolon, and no space before ? and ! (the catalogue's
// Canadian usage), so a line never breaks inside a quotation or before its punctuation.
// English (en-CA.json): curly apostrophes and quotation marks (’ “ ”), as in the rest of the
// catalogue. apps/web/src/i18n/messages.test.ts fails on any string this would change.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../../apps/web/messages/', import.meta.url);

export function frenchTypography(text) {
  return text
    .replace(/«[ \u00a0\u202f]*/g, '«\u00a0')
    .replace(/[ \u00a0\u202f]*»/g, '\u00a0»')
    .replace(/[ \u00a0\u202f]+:/g, '\u00a0:')
    .replace(/(?<=\S)[ \u00a0\u202f]?;/g, '\u202f;')
    .replace(/[ \u00a0\u202f]+([?!])/g, '$1');
}

export function englishQuotes(text) {
  return text.replace(/"([^"]*)"/g, '“$1”').replace(/'/g, '’');
}

function mapStrings(tree, fn) {
  return Object.fromEntries(
    Object.entries(tree).map(([k, v]) => [k, typeof v === 'string' ? fn(v) : mapStrings(v, fn)]),
  );
}

function rewrite(file, fn) {
  const url = new URL(file, dir);
  const before = readFileSync(url, 'utf8');
  const after = `${JSON.stringify(mapStrings(JSON.parse(before), fn), null, 2)}\n`;
  if (after !== before) writeFileSync(url, after);
  return after !== before;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fr = rewrite('fr-CA.json', frenchTypography);
  const en = rewrite('en-CA.json', (s) => s);
  const enTree = JSON.parse(readFileSync(new URL('en-CA.json', dir), 'utf8'));
  enTree.board = mapStrings(enTree.board, englishQuotes);
  const enText = `${JSON.stringify(enTree, null, 2)}\n`;
  const enChanged = enText !== readFileSync(new URL('en-CA.json', dir), 'utf8');
  if (enChanged) writeFileSync(new URL('en-CA.json', dir), enText);
  console.log(
    `fr-CA.json ${fr ? 'updated' : 'unchanged'}, en-CA.json ${en || enChanged ? 'updated' : 'unchanged'}`,
  );
}
