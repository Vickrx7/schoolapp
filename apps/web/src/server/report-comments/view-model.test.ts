import type { ReportPeriod } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import {
  aiBankHref,
  bankOptions,
  composerBank,
  composerHref,
  composerPeriod,
  composerSubject,
  newBankHref,
  scopeOf,
  type BankCandidate,
} from './view-model';

const year = { startsOn: '2026-09-02', endsOn: '2027-06-25' };
const periods: ReportPeriod[] = [
  {
    kind: 'term1',
    startsOn: '2026-09-02',
    endsOn: '2027-01-29',
    dueOn: '2027-02-05',
    issuedOn: '2027-02-12',
  },
  {
    kind: 'progress',
    startsOn: '2026-09-02',
    endsOn: '2026-10-30',
    dueOn: '2026-11-06',
    issuedOn: null,
  },
  { kind: 'term2', startsOn: '2027-02-01', endsOn: '2027-06-11', dueOn: null, issuedOn: null },
];

describe('« Période » in « Bulletins » (D-130)', () => {
  it('takes a board period from the address, with its key, window, report and expiry', () => {
    const p = composerPeriod({ period: 'term1' }, periods, year, '2026-10-03');
    expect(p).toMatchObject({
      choice: 'term1',
      key: 'term1',
      window: { startsOn: '2026-09-02', endsOn: '2027-01-29' },
      report: 'term',
      expiresOn: '2027-04-13',
      invalid: false,
    });
    expect(composerPeriod({ period: ['progress'] }, periods, year, '2026-10-03').report).toBe(
      'progress',
    );
  });

  it('opens on the first period whose saisie has not passed, else the last one', () => {
    expect(composerPeriod({}, periods, year, '2026-10-03').choice).toBe('progress');
    expect(composerPeriod({}, periods, year, '2026-11-06').choice).toBe('progress');
    expect(composerPeriod({}, periods, year, '2026-11-07').choice).toBe('term1');
    expect(composerPeriod({ period: 'nope' }, periods, year, '2027-03-01').choice).toBe('term2');
    expect(composerPeriod({}, periods, year, '2027-08-01').choice).toBe('term2');
  });

  it('takes « Dates choisies » with two dates in order and the report chosen', () => {
    const p = composerPeriod(
      { period: 'custom', from: '2027-01-04', to: '2027-01-29', kind: 'progress' },
      periods,
      year,
      '2026-10-03',
    );
    expect(p).toMatchObject({
      choice: 'custom',
      key: 'custom-2027-01-04-2027-01-29-progress',
      report: 'progress',
      expiresOn: '2027-03-30',
      invalid: false,
      reportPeriod: null,
    });
    const wrong = composerPeriod(
      { period: 'custom', from: '2027-01-29', to: '2027-01-04' },
      periods,
      year,
      '2026-10-03',
    );
    expect(wrong).toMatchObject({
      invalid: true,
      report: 'term',
      window: { startsOn: '2026-09-02', endsOn: '2026-10-03' },
    });
  });

  it('falls back to « Dates choisies » when the board has set no period', () => {
    const p = composerPeriod({}, [], year, '2027-08-01');
    expect(p).toMatchObject({
      choice: 'custom',
      invalid: false,
      window: { startsOn: '2026-09-02', endsOn: '2027-06-25' },
    });
  });
});

describe('« Matière » and « Banque » (D-130, D-135)', () => {
  const choices = [
    { key: 'learning_skills', group: 'learning_skills' as const, subject: null },
    { key: 's-mat', group: 'mine' as const, subject: { id: 's-mat', code: 'mat' } },
    { key: 's-ere', group: 'other' as const, subject: { id: 's-ere', code: 'ere' } },
  ];

  it('chooses the subject of the address, else the first, and its bank scope', () => {
    expect(composerSubject('s-mat', choices).key).toBe('s-mat');
    expect(composerSubject('unknown', choices).key).toBe('learning_skills');
    expect(scopeOf(choices[0]!)).toBe('learning_skills');
    expect(scopeOf(choices[1]!)).toBe('subject');
    expect(scopeOf(choices[2]!)).toBe('religion');
  });

  const bank = (over: Partial<BankCandidate>): BankCandidate => ({
    id: '20000000-0000-4000-8000-000000000001',
    title: 'Banque',
    status: 'board_approved',
    source: 'board_created',
    mine: false,
    scope: 'subject',
    period: 'term',
    gradeCodes: ['3'],
    ...over,
  });

  it('offers the banks of the scope that serve the report, each once, in the search’s order', () => {
    const candidates = [
      bank({ id: 'a', period: 'term' }),
      bank({ id: 'b', period: 'progress' }),
      bank({ id: 'c', period: 'any', status: 'draft' }),
      bank({ id: 'a', period: 'term' }),
      bank({ id: 'd', scope: 'learning_skills', period: 'any' }),
      bank({ id: 'e', period: null }),
      bank({ id: 'f', period: 'weekly' }),
    ];
    expect(bankOptions(candidates, 'subject', 'term').map((b) => b.id)).toEqual(['a', 'c']);
    expect(bankOptions(candidates, 'subject', 'progress').map((b) => b.id)).toEqual(['b', 'c']);
    expect(bankOptions(candidates, 'learning_skills', 'term').map((b) => b.id)).toEqual(['d']);
    const options = bankOptions(candidates, 'subject', 'term');
    expect(composerBank('c', options)?.id).toBe('c');
    expect(composerBank('zzz', options)?.id).toBe('a');
    expect(composerBank(undefined, [])).toBeNull();
  });
});

describe('the addresses of « Bulletins » (D-130, D-132)', () => {
  const id = '20000000-0000-4000-8000-000000030b11';
  const id2 = '20000000-0000-4000-8000-000000030b12';

  it('holds filters only', () => {
    expect(composerHref('c1', { period: 'term1', subject: 's1', bank: id })).toBe(
      `/classes/c1/bulletins?period=term1&subject=s1&bank=${id}`,
    );
    expect(
      composerHref('c1', {
        period: 'custom',
        from: '2027-01-04',
        to: '2027-01-29',
        kind: 'progress',
        bank: 'not an id',
      }),
    ).toBe('/classes/c1/bulletins?period=custom&from=2027-01-04&to=2027-01-29&kind=progress');
  });

  it('prefills « Créer une banque avec l’IA » with ids only, at most 12 attentes', () => {
    expect(
      aiBankHref({
        scope: 'subject',
        gradeCode: '3',
        subjectId: id,
        report: 'term',
        expectationIds: [id, id2, 'Aïcha'],
      }),
    ).toBe(
      `/library/generate/comments?scope=subject&grade=3&subject=${id}&period=term&exp=${id},${id2}`,
    );
    const many = Array.from({ length: 14 }, (_, i) => id.slice(0, -2) + String(i).padStart(2, '0'));
    const href = aiBankHref({
      scope: 'subject',
      gradeCode: '3',
      subjectId: id,
      report: 'progress',
      expectationIds: many,
    });
    expect(new URL(href, 'http://x').searchParams.get('exp')!.split(',')).toHaveLength(12);
    expect(
      aiBankHref({
        scope: 'learning_skills',
        gradeCode: '5',
        subjectId: null,
        report: 'term',
        expectationIds: [id],
      }),
    ).toBe('/library/generate/comments?scope=learning_skills&grade=5&period=term');
    expect(newBankHref({ gradeCode: '3', subjectId: null })).toBe(
      '/library/new?type=report_comments&grade=3',
    );
  });
});
