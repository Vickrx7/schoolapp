import { describe, expect, it } from 'vitest';
import { parseCurriculumFile } from './curriculum-import';

const file = () => ({
  official: false,
  verified: false,
  subjectCode: 'fra',
  curriculumVersion: 'fra-2023',
  strands: [{ code: 'C', labelFr: 'Compréhension' }],
  expectations: [
    {
      grade: '5',
      code: 'C1',
      kind: 'overall',
      strandCode: 'C',
      parentCode: null,
      textFr: 'Comprendre des textes.',
    },
    {
      grade: '5',
      code: 'C1.2',
      kind: 'specific',
      strandCode: 'C',
      parentCode: 'C1',
      textFr: 'Dégager l’idée principale.',
    },
  ],
});

const errors = (value: unknown, options = {}) =>
  parseCurriculumFile(value, options).errors.map((e) => `${e.path}:${e.message}`);

describe('curriculum-import', () => {
  it('accepts a valid file, as text or as a value', () => {
    const parsed = parseCurriculumFile(JSON.stringify(file()));
    expect(parsed.errors).toEqual([]);
    expect(parsed.data!.expectations[1]).toMatchObject({ parentCode: 'C1', textEn: null });
    expect(parseCurriculumFile(file()).data).toEqual(parsed.data);
  });

  it('48. errors carry their path', () => {
    const { textFr: _t, ...noText } = file().expectations[0]!;
    expect(errors({ ...file(), expectations: [noText, file().expectations[1]] })).toEqual([
      expect.stringMatching(/^expectations\.0\.textFr:/),
    ]);
    const badKind = file();
    badKind.expectations[1]!.kind = 'detailed';
    expect(errors(badKind)).toEqual(['expectations.1.kind:invalidKind']);
    const unknownParent = file();
    unknownParent.expectations[1]!.parentCode = 'C9';
    expect(errors(unknownParent)).toEqual(['expectations.1.parentCode:unknownParent']);
    const otherGrade = file();
    otherGrade.expectations[1]!.grade = '6';
    expect(errors(otherGrade)).toEqual(['expectations.1.parentCode:unknownParent']);
    const duplicate = file();
    duplicate.expectations.push({ ...duplicate.expectations[1]! });
    expect(errors(duplicate)).toEqual(['expectations.2.code:duplicateCode']);
    const strandTwice = {
      ...file(),
      strands: [...file().strands, { code: 'C', labelFr: 'Autre' }],
    };
    expect(errors(strandTwice)).toEqual(['strands.1.code:duplicateCode']);
    const noStrand = file();
    noStrand.expectations[0]!.strandCode = 'Z';
    expect(errors(noStrand)).toEqual(['expectations.0.strandCode:unknownStrand']);
    const orphan = file();
    orphan.expectations[1]!.parentCode = null;
    expect(errors(orphan)).toEqual(['expectations.1.parentCode:parentRequired']);
    expect(errors('{ pas du json')).toEqual([':invalidJson']);
  });

  it('48. an official or verified file needs the licence confirmation', () => {
    expect(errors({ ...file(), official: true })).toEqual(['official:licenceConfirmationRequired']);
    expect(errors({ ...file(), verified: true })).toEqual(['verified:licenceConfirmationRequired']);
    expect(parseCurriculumFile({ ...file(), official: true }).data).toBeNull();
    expect(errors({ ...file(), official: true }, { confirmLicence: true })).toEqual([]);
  });
});
