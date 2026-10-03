import { describe, expect, it } from 'vitest';
import { csvCell, csvDocument, csvSeparator } from './csv';

describe('CSV files', () => {
  it('separates cells with ; in French and , in English', () => {
    expect(csvSeparator('fr-CA')).toBe(';');
    expect(csvSeparator('en-CA')).toBe(',');
  });

  it('writes numbers with the decimal mark of the language', () => {
    expect(csvCell(12.5, ';')).toBe('12,5');
    expect(csvCell(12.5, ',')).toBe('12.5');
    expect(csvCell(0, ';')).toBe('0');
    expect(csvCell(Number.NaN, ',')).toBe('');
  });

  it('quotes cells holding the separator, quotes or line breaks', () => {
    expect(csvCell('Saint-Exemple; annexe', ';')).toBe('"Saint-Exemple; annexe"');
    expect(csvCell('Saint-Exemple; annexe', ',')).toBe('Saint-Exemple; annexe');
    expect(csvCell('a, b', ',')).toBe('"a, b"');
    expect(csvCell('« Le "grand" jour »', ';')).toBe('"« Le ""grand"" jour »"');
    expect(csvCell('ligne 1\nligne 2', ';')).toBe('"ligne 1\nligne 2"');
    expect(csvCell(null, ';')).toBe('');
  });

  it('never lets a spreadsheet run a cell as a formula', () => {
    for (const value of ['=1+1', '+33', '-2', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(value, ',').replace(/^"/, '').startsWith("'"), value).toBe(true);
    }
    expect(csvCell('=HYPERLINK("x";"y")', ';')).toBe('"\'=HYPERLINK(""x"";""y"")"');
    // A negative number stays a number.
    expect(csvCell(-2, ',')).toBe('-2');
  });

  it('starts with a byte order mark and ends lines with CRLF', () => {
    expect(
      csvDocument(
        [
          ['École', 'Coût'],
          ['É.É.C. Saint-Exemple', 1.25],
        ],
        'fr-CA',
      ),
    ).toBe('﻿École;Coût\r\nÉ.É.C. Saint-Exemple;1,25\r\n');
  });
});
