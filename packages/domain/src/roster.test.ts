import { describe, expect, it } from 'vitest';
import {
  classifyColumn,
  cleanFirstName,
  decodeCsvBytes,
  prepareRosterImport,
  rowsFromPastedText,
  suggestFirstNameColumn,
} from './roster';

describe('classifyColumn', () => {
  it('recognizes first-name columns in French and English', () => {
    for (const h of [
      'Prénom',
      'prenom',
      'Prénom usuel',
      'First Name',
      'first_name',
      'Surnom',
      'Preferred name',
    ]) {
      expect(classifyColumn(h), h).toBe('first_name');
    }
  });

  it('flags columns that must never be imported', () => {
    for (const h of [
      'Nom de famille',
      'Nom',
      'Last Name',
      'NISO',
      'OEN',
      'Date de naissance',
      'Birthdate',
      'Adresse',
      'Courriel',
      'Email parent',
      'Téléphone',
      "Numéro d'élève",
      'Sexe',
    ]) {
      expect(classifyColumn(h), h).toBe('sensitive');
    }
  });

  it('leaves other columns as other', () => {
    expect(classifyColumn('Groupe')).toBe('other');
  });

  it('suggests the first-name column', () => {
    expect(suggestFirstNameColumn(['NISO', 'Nom', 'Prénom', 'Date de naissance'])).toBe(2);
    expect(suggestFirstNameColumn(['A', 'B'])).toBe(-1);
  });
});

describe('cleanFirstName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanFirstName('  Marie-Ève  ')).toEqual({ value: 'Marie-Ève', warnings: [] });
    expect(cleanFirstName('Jean   Philippe').value).toBe('Jean Philippe');
  });

  it('warns about values that look like more than a first name', () => {
    expect(cleanFirstName('Tremblay, Marie').warnings).toContain('contains_comma');
    expect(cleanFirstName('Marie Tremblay').warnings).toContain('looks_like_full_name');
    expect(cleanFirstName('marie@ecole.ca').warnings).toContain('looks_like_email');
    expect(cleanFirstName('Liam 2').warnings).toContain('contains_digits');
    expect(cleanFirstName('').warnings).toContain('empty');
    expect(cleanFirstName('x'.repeat(41)).warnings).toContain('too_long');
  });

  it('accepts accented and hyphenated names without warnings', () => {
    for (const name of ['Aïcha', 'Zoé', 'Jean-François', 'Maëlle', 'Nour']) {
      expect(cleanFirstName(name).warnings, name).toEqual([]);
    }
  });
});

describe('prepareRosterImport', () => {
  it('keeps only the chosen column and flags duplicates and blocked rows', () => {
    const rows = [
      ['123456789', 'Tremblay', 'Léa', '2018-04-02'],
      ['987654321', 'Roy', 'Nathan', '2018-01-15'],
      ['111111111', 'Roy', 'léa', '2018-06-30'],
      ['222222222', 'Côté', '', '2018-03-03'],
    ];
    const result = prepareRosterImport(rows, 2, ['Nathan']);
    expect(result.map((r) => r.value)).toEqual(['Léa', 'Nathan', 'léa', '']);
    expect(result.map((r) => r.duplicate)).toEqual([false, true, true, false]);
    expect(result.map((r) => r.blocked)).toEqual([false, false, false, true]);
    // Nothing from other columns leaks into the result.
    expect(JSON.stringify(result)).not.toMatch(/Tremblay|123456789|2018/);
  });
});

describe('decodeCsvBytes', () => {
  it('decodes UTF-8 and strips a byte-order mark', () => {
    const bytes = new TextEncoder().encode('﻿Prénom\nZoé\n');
    expect(decodeCsvBytes(bytes)).toBe('Prénom\nZoé\n');
  });

  it('falls back to Windows-1252 for files saved by Excel in French', () => {
    // "Prénom;Zoé" in Windows-1252: é = 0xE9.
    const bytes = new Uint8Array([0x50, 0x72, 0xe9, 0x6e, 0x6f, 0x6d, 0x3b, 0x5a, 0x6f, 0xe9]);
    expect(decodeCsvBytes(bytes)).toBe('Prénom;Zoé');
  });
});

describe('rowsFromPastedText', () => {
  it('turns pasted lines into rows and drops blank lines', () => {
    expect(rowsFromPastedText('Léa\r\n\n  Nathan \nZoé')).toEqual([['Léa'], ['Nathan'], ['Zoé']]);
  });
});
