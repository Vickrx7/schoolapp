import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptText, parseKeyRing } from '../alerts-crypto';
import {
  decryptReportNotes,
  EMPTY_REPORT_NOTES,
  encryptReportNotes,
  hasReportNotes,
  reportNotesAad,
} from './notes';

const ring = parseKeyRing(`1:${randomBytes(32).toString('base64')}`)!;
const PLAN = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAN = '22222222-2222-4222-8222-222222222222';
const BLOCK = '33333333-3333-4333-8333-333333333333';

describe('report notes', () => {
  const notes = {
    lessonNotes: { [BLOCK]: 'Nous avons lu la page 12 ensemble.' },
    behaviour: 'Liam était agité après la récréation.',
    forTeacher: '',
  };

  it('round-trips and never stores the text in the clear', () => {
    const sealed = encryptReportNotes(notes, PLAN, ring)!;
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.ciphertext).toMatch(/^v1\./);
    expect(sealed.ciphertext).not.toContain('Liam');
    expect(decryptReportNotes(sealed.ciphertext, PLAN, ring)).toEqual(notes);
  });

  it('is bound to its plan', () => {
    const sealed = encryptReportNotes(notes, PLAN, ring)!;
    expect(decryptReportNotes(sealed.ciphertext, OTHER_PLAN, ring)).toBeNull();
    expect(decryptText(sealed.ciphertext, reportNotesAad(PLAN), ring)).toContain('Liam');
  });

  it('stores nothing for an empty report and drops blank lesson notes', () => {
    expect(hasReportNotes(EMPTY_REPORT_NOTES)).toBe(false);
    expect(encryptReportNotes({ ...EMPTY_REPORT_NOTES, behaviour: '   ' }, PLAN, ring)).toBeNull();
    const sealed = encryptReportNotes(
      { lessonNotes: { [BLOCK]: '  ' }, behaviour: '', forTeacher: ' Merci! ' },
      PLAN,
      ring,
    )!;
    expect(decryptReportNotes(sealed.ciphertext, PLAN, ring)).toEqual({
      lessonNotes: {},
      behaviour: '',
      forTeacher: 'Merci!',
    });
  });

  it('reads nothing from a damaged value', () => {
    expect(decryptReportNotes('v1.abc', PLAN, ring)).toBeNull();
    expect(decryptReportNotes('v9.a.b.c', PLAN, ring)).toBeNull();
  });
});
