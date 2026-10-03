import { priceFor } from '@lynx/ai';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext } from '../context';
import {
  bulkCommands,
  estimateRun,
  parseMaxCost,
  parsePlanOptions,
  parseRunId,
  planParams,
  planSummary,
  parseTypes,
  REPORT_CSV_HEADER,
  reportCsv,
  reportText,
  requestCounts,
  requestWorstCases,
  runPrice,
  type PlanResult,
} from './bulk';

const values = (...argv: string[]) => parseCli(['bulk-plan', ...argv]).values;

describe('bulk-plan options', () => {
  it('reads the plan of the example command line', () => {
    const options = parsePlanOptions(
      values(
        '--board',
        'csc-demo',
        '--grade',
        '3',
        '--subject',
        'MAT',
        '--types',
        'worksheet, quiz',
        '--max-cost',
        '25',
        '--from-coverage',
        '2',
        '--note',
        '  Automne  ',
      ),
      100,
    );
    expect(options).toEqual({
      grades: ['3'],
      subjectCode: 'mat',
      types: ['worksheet', 'quiz'],
      maxCost: 25,
      levels: 'all',
      perExpectation: 1,
      subFriendly: false,
      strandCodes: null,
      expectationCodes: null,
      fromCoverage: 2,
      note: 'Automne',
    });
    expect(planParams(options, 'subject-id')).toEqual({
      gradeCodes: ['3'],
      subjectId: 'subject-id',
      types: ['worksheet', 'quiz'],
      levels: 'all',
      perExpectation: 1,
      subFriendly: false,
      // Each type's default duration (TYPE_INFO).
      durations: { worksheet: 30, quiz: 20 },
      fromCoverage: { minApproved: 2 },
    });
  });

  it('takes one or two grades, attente codes or a domaine', () => {
    const options = parsePlanOptions(
      values(
        '--grade',
        '3,k2',
        '--subject',
        'fra',
        '--types',
        'quiz',
        '--max-cost',
        '5',
        '--expectations',
        'B1.1, B1.2',
        '--levels',
        'none',
        '--per-expectation',
        '3',
      ),
      100,
    );
    expect(options).toMatchObject({
      grades: ['3', 'K2'],
      expectationCodes: ['B1.1', 'B1.2'],
      levels: 'none',
      perExpectation: 3,
    });
    expect(
      parsePlanOptions(
        values(
          '--grade',
          '5',
          '--subject',
          'sci',
          '--types',
          'experiment',
          '--max-cost',
          '5',
          '--strand',
          'B',
        ),
        100,
      ).strandCodes,
    ).toEqual(['B']);
  });

  it.each([
    [['--types', 'quiz,catholic_reflection'], /one at a time/],
    [['--types', 'quiz,essay'], /unknown type "essay"/],
    [['--types', 'quiz,quiz'], /twice/],
    [['--types', 'quiz,worksheet,game,song,riddle,project,rubric'], /at most 6/],
    [['--grade', '3,5,6'], /one or two/],
    [['--levels', 'some'], /all or none/],
    [['--per-expectation', '4'], /1 to 3/],
    [['--from-coverage', '0'], /1 to 5/],
    [['--expectations', 'B1.1', '--strand', 'B'], /one of --strand/],
    [['--note', 'x'.repeat(1001)], /1,000/],
    [['--max-cost', '0'], /positive/],
    [['--max-cost', '1.234'], /2 decimals/],
  ])('refuses %j before reaching the database', (extra, message) => {
    const base: Record<string, string> = {
      '--grade': '3',
      '--subject': 'mat',
      '--types': 'quiz',
      '--max-cost': '5',
    };
    for (let i = 0; i < extra.length; i += 2) base[extra[i]!] = extra[i + 1]!;
    const argv = Object.entries(base).flat();
    expect(() => parsePlanOptions(values(...argv), 100)).toThrow(message);
  });

  it('never plans a run above BULK_MAX_RUN_USD (the worker would refuse it)', () => {
    expect(parseMaxCost('100', 100)).toBe(100);
    expect(parseMaxCost('25.50', 100)).toBe(25.5);
    expect(() => parseMaxCost('100.01', 100)).toThrow(/BULK_MAX_RUN_USD \(100\)/);
    expect(() => parseMaxCost('30', 25)).toThrow(/above BULK_MAX_RUN_USD \(25\)/);
    // The database's own limit, whatever the setting.
    expect(() => parseMaxCost('1001', 1000)).toThrow(CliError);
    expect(() => parseMaxCost(undefined, 100)).toThrow(/--max-cost is required/);
  });

  it('reads types and run ids strictly', () => {
    expect(parseTypes('exit_ticket')).toEqual(['exit_ticket']);
    expect(() => parseTypes('')).toThrow(/--types is required/);
    expect(() => parseTypes('lecture')).toThrow(/unknown type/);
    // Comment banks have their own request; they are not generated in bulk (D-129).
    expect(() => parseTypes('quiz,report_comments')).toThrow(/not generated in bulk/);
    expect(parseRunId('5F1C0000-0000-4000-8000-000000000001')).toBe(
      '5f1c0000-0000-4000-8000-000000000001',
    );
    expect(() => parseRunId('5f1c')).toThrow(/--run/);
  });
});

describe('the estimate', () => {
  it('sends the prefix that fits under the cap and prints worst case and usual cost', () => {
    // $0.66 at worst each (Opus 5.5 at batch prices, 64,000 tokens out), one refused.
    const estimate = estimateRun([0.66, 0.66, null, 0.66, 0.66], 2);
    expect(estimate).toMatchObject({ requests: 5, refused: 1, fit: 3, over: 1 });
    expect(estimate.worstCaseUsd).toBeCloseTo(2.64, 6);
    expect(estimate.fitWorstCaseUsd).toBeCloseTo(1.98, 6);
    expect(estimate.fitWorstCaseUsd).toBeLessThanOrEqual(2);
    expect(estimate.usualLowUsd).toBeCloseTo(0.198, 6);
    expect(estimate.usualHighUsd).toBeCloseTo(0.594, 6);

    const plan: PlanResult = {
      runId: 'run-1',
      planned: 5,
      skipped: { covered: 2 },
      byType: { quiz: { planned: 3, covered: 2 }, worksheet: { planned: 2, covered: 0 } },
    };
    expect(
      planSummary(
        {
          board: 'Conseil démo',
          grades: ['3'],
          subject: 'Mathématiques',
          types: ['quiz', 'worksheet'],
          levels: 'all',
          maxCost: 2,
        },
        plan,
        estimate,
      ),
    ).toBe(
      [
        'Planned run run-1 for Conseil démo: 3, Mathématiques; quiz, worksheet (levels: all).',
        '  5 requests · 2 already covered · worst case 2.64 USD · usually 0.20 USD–0.59 USD · cap 2.00 USD',
        '  3 requests fit under the cap by this estimate; 1 exceed it and will be skipped (the worker counts tokens exactly, so it may send a few more).',
        '  1 requests will be refused before sending: a personal detail (an e-mail address, a phone number…) in the note or in an existing title.',
        '  By type: quiz 3 (2 covered) · worksheet 2',
        'Start it with: pnpm admin bulk-start --run run-1',
      ].join('\n'),
    );
  });

  it('prices a request like the worker, never below its real worst case', async () => {
    const input = {
      itemType: 'quiz',
      gradeCodes: ['3'],
      gradeLabels: ['3e année'],
      subjectId: 'ece67150-44d3-4e6e-b772-d9bde2165caf',
      subjectLabel: 'Mathématiques',
      strandLabel: 'Nombres',
      expectations: [
        {
          key: 'E1',
          expectationId: '20000000-0000-4000-8000-000000030b12',
          code: 'B1.2',
          text: 'Comparer des nombres.',
        },
      ],
      levels: [],
      catholic: null,
      durationMinutes: 20,
      subFriendly: false,
      teacherNote: 'Automne.',
    };
    const price = priceFor('claude-opus-5-5');
    const [worst, refused] = await requestWorstCases(
      [input, { ...input, teacherNote: 'Appelez le 613-555-0123.' }],
      price,
    );
    // At least the output bound: 64,000 tokens at $20 per million, halved.
    expect(worst).toBeGreaterThan(0.64);
    expect(worst).toBeLessThan(1);
    expect(refused).toBeNull();
  });

  it('prices runs with the worker’s settings', () => {
    expect(runPrice({ AI_PROVIDER: 'fake', AI_MODEL: 'claude-opus-5-5' })).toEqual(
      priceFor('fake'),
    );
    expect(runPrice({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-opus-5-5' })).toEqual(
      priceFor('claude-opus-5-5'),
    );
    expect(
      runPrice({
        AI_PROVIDER: 'anthropic',
        AI_MODEL: 'claude-new',
        AI_PRICE_INPUT_PER_MTOK: 3,
        AI_PRICE_OUTPUT_PER_MTOK: 15,
      }),
    ).toMatchObject({ input: 3, output: 15 });
    expect(() => runPrice({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-new' })).toThrow(CliError);
  });
});

describe('the report', () => {
  const rows = [
    {
      id: 'r1',
      item_type: 'quiz',
      status: 'created',
      reason: null,
      problems: ['similar_title'],
      worst_case_usd: 0.66,
      cost_usd: 0.12,
      item_id: 'i1',
      curriculum_expectations: { code: 'B1.1', grade_code: '3' },
      library_items: { title: 'Quiz, « nombres »', status: 'draft' },
    },
    {
      id: 'r2',
      item_type: 'quiz',
      status: 'failed',
      reason: 'aiRefused',
      problems: [],
      worst_case_usd: 0.66,
      cost_usd: 0.02,
      item_id: null,
      curriculum_expectations: { code: 'B1.2', grade_code: '3' },
      library_items: null,
    },
    {
      id: 'r3',
      item_type: 'worksheet',
      status: 'skipped',
      reason: 'covered',
      problems: [],
      worst_case_usd: null,
      cost_usd: 0,
      item_id: null,
      curriculum_expectations: { code: 'B1.2', grade_code: '3' },
      library_items: null,
    },
  ];

  it('counts requests by status and reason', () => {
    expect(requestCounts(rows)).toBe('1 created · 1 failed (aiRefused) · 1 skipped (covered)');
    expect(requestCounts([])).toBe('none');
  });

  it('writes RFC 4180 CSV, one row per request', () => {
    const csv = reportCsv('run-1', rows).split('\n');
    expect(csv[0]).toBe(REPORT_CSV_HEADER.join(','));
    expect(csv[1]).toBe(
      'run-1,3,B1.1,quiz,created,,similar_title,0.660000,0.120000,i1,draft,"Quiz, « nombres »"',
    );
    expect(csv).toHaveLength(4);
  });

  it('explains the report in words', () => {
    const text = reportText(
      {
        id: 'run-1',
        status: 'completed',
        report: {
          created: 1,
          similarTitles: 1,
          skipped: { covered: 1, costCap: 0, cancelled: 0 },
          failed: { aiRefused: 1 },
          spentUsd: 0.14,
          worstCaseUsd: 1.32,
          maxCostUsd: 5,
        },
      },
      'Conseil démo',
      rows,
    );
    expect(text).toContain(
      '1 created · 1 similar titles · skipped: 1 covered, 0 over the cap, 0 cancelled · failed: 1 aiRefused',
    );
    expect(text).toContain('Spent 0.14 USD of a worst case of 1.32 USD (cap 5.00 USD)');
    expect(text).toContain('« Quiz, « nombres » » (draft) [similar_title]');
    expect(text).toContain('aiRefused: the model declined');
    expect(text).toContain('plans only what is still missing');
  });
});

describe('bulk commands', () => {
  it('check their options before reading the settings or the database', async () => {
    const run = (command: string, ...argv: string[]) =>
      bulkCommands[command]!(createContext(parseCli([command, ...argv]).values));
    await expect(run('bulk-start')).rejects.toThrow(/--run/);
    await expect(run('bulk-status', '--run', 'nope')).rejects.toThrow(/--run/);
    await expect(run('bulk-cancel')).rejects.toThrow(CliError);
    await expect(run('bulk-report', '--run', '1')).rejects.toThrow(/--run/);
    await expect(run('bulk-plan', '--grade', '3')).rejects.toThrow(/--board is required/);
  });
});
