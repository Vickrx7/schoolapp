import type { AdminEnv } from '@lynx/config';
import type { Database } from '@lynx/db';
import { createClient } from '@supabase/supabase-js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext, type CliContext } from '../context';
import {
  formatProblems,
  importReportSchema,
  importText,
  parseReferencesFile,
  referenceCommands,
  referenceRows,
  REFERENCES_LICENCE_WARNING,
  SAMPLE_NOTE,
  typographyNotes,
  type ReferencesReport,
} from './references';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const SAMPLE = path.join(root, 'content/catholic-references/sample.json');
const sampleJson = () => JSON.parse(readFileSync(SAMPLE, 'utf8')) as Record<string, unknown>;

/** A small valid file; `entries` replaces its references. */
function file(entries?: unknown[], header: Record<string, unknown> = {}) {
  return {
    sample: false,
    official: false,
    sourceNote: 'Texte du conseil.',
    references: entries ?? [
      { type: 'virtue', title: 'La paix', textFr: 'Je cherche la paix avec les autres.' },
      {
        type: 'prayer',
        title: 'Prière du matin',
        textFr: 'Seigneur, merci pour cette journée. Amen.',
        textEn: 'Lord, thank you for this day. Amen.',
        gradeMin: 'K2',
        gradeMax: '3',
        liturgicalSeason: 'avent',
        tags: ['prière', 'matin'],
        sourceNote: null,
        active: false,
      },
    ],
    ...header,
  };
}

const problemsOf = (value: unknown) => parseReferencesFile(value).problems;

describe('the sample file', () => {
  const parsed = parseReferencesFile(readFileSync(SAMPLE, 'utf8'));

  it('is valid, says it is a sample, and claims no published text', () => {
    expect(parsed.problems).toEqual([]);
    expect(parsed.data).toMatchObject({ sample: true, official: false });
    expect(parsed.data!.sourceNote).toMatch(/à vérifier/);
    expect(parsed.data!.references.length).toBeGreaterThanOrEqual(5);
  });

  it('follows the French typography rules', () => {
    expect(typographyNotes(parsed.data!)).toEqual([]);
    expect(JSON.stringify(sampleJson())).not.toMatch(/\p{L}'\p{L}/u);
  });

  it('carries no scripture or liturgical text, only a reference to a passage', () => {
    const scripture = parsed.data!.references.filter((r) => r.type === 'scripture');
    expect(scripture.length).toBeGreaterThan(0);
    for (const r of scripture) {
      expect(r.title).toMatch(/\([1-3]?\s?[A-Z][a-z]+ \d+, \d+-\d+\)$/);
      expect(referenceRows(parsed.data!).find((row) => row.title === r.title)!.sourceNote).toMatch(
        /aucun texte biblique/,
      );
    }
  });

  it('has every reference of the demo seed, with its type, grades, season, tags and text', () => {
    const seed = seedReferences();
    expect(seed.length).toBe(7);
    const curly = (text: string) => text.replaceAll("'", '’');
    const ordinal = (code: string) => (code === 'K1' ? -1 : code === 'K2' ? 0 : Number(code));
    for (const [, type, title, textFr, textEn, gradeMin, gradeMax, season, tags] of seed) {
      const entry = parsed.data!.references.find(
        (r) => r.type === type && r.title === curly(title as string),
      );
      expect(entry, String(title)).toBeDefined();
      expect(entry!.textFr).toBe(curly(textFr as string));
      expect(entry!.textEn).toBe(textEn);
      expect([ordinal(entry!.gradeMin), ordinal(entry!.gradeMax)]).toEqual([gradeMin, gradeMax]);
      expect(entry!.liturgicalSeason).toBe(season);
      expect(entry!.tags).toEqual((tags as string).slice(1, -1).split(','));
    }
  });
});

/** The rows of supabase/seed.sql's Catholic references, as SQL values (strings, numbers, null). */
function seedReferences(): (string | number | null)[][] {
  const sql = readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8');
  const start = sql.indexOf('insert into public.catholic_references');
  const values = sql.slice(sql.indexOf(' values', start) + 7, sql.indexOf(';\n', start));
  const rows: (string | number | null)[][] = [];
  let row: (string | number | null)[] | null = null;
  for (let i = 0; i < values.length; i++) {
    const c = values[i]!;
    if (!row) {
      if (c === '(') row = [];
    } else if (c === ')') {
      rows.push(row);
      row = null;
    } else if (c === "'") {
      let text = '';
      for (i++; i < values.length; i++) {
        if (values[i] !== "'") text += values[i];
        else if (values[i + 1] === "'") text += values[++i];
        else break;
      }
      row.push(text);
    } else if (/[-\d]/.test(c)) {
      const number = /^-?\d+/.exec(values.slice(i))![0];
      row.push(Number(number));
      i += number.length - 1;
    } else if (values.startsWith('null', i)) {
      row.push(null);
      i += 3;
    }
  }
  return rows;
}

describe('parseReferencesFile', () => {
  it('fills the defaults and resolves each source note', () => {
    const { data, problems } = parseReferencesFile(JSON.stringify(file()));
    expect(problems).toEqual([]);
    expect(referenceRows(data!)).toEqual([
      {
        type: 'virtue',
        title: 'La paix',
        textFr: 'Je cherche la paix avec les autres.',
        textEn: null,
        gradeMin: 'K1',
        gradeMax: '8',
        liturgicalSeason: null,
        tags: [],
        sourceNote: 'Texte du conseil.',
        active: true,
      },
      {
        type: 'prayer',
        title: 'Prière du matin',
        textFr: 'Seigneur, merci pour cette journée. Amen.',
        textEn: 'Lord, thank you for this day. Amen.',
        gradeMin: 'K2',
        gradeMax: '3',
        liturgicalSeason: 'avent',
        tags: ['prière', 'matin'],
        // Null in the entry: none, whatever the file's note.
        sourceNote: null,
        active: false,
      },
    ]);
  });

  it('trims texts, and reads an empty English text or note as none', () => {
    const { data } = parseReferencesFile(
      file(
        [{ type: 'virtue', title: '  La paix ', textFr: ' Paix. ', textEn: ' ', tags: [' paix '] }],
        {
          sourceNote: '',
        },
      ),
    );
    expect(referenceRows(data!)[0]).toMatchObject({
      title: 'La paix',
      textFr: 'Paix.',
      textEn: null,
      tags: ['paix'],
      sourceNote: null,
    });
  });

  it('names the entry of every problem: its number, type and title', () => {
    const problems = problemsOf(
      file([
        { type: 'virtue', title: 'La paix', textFr: 'Paix.' },
        { type: 'virtue', title: 'La joie' },
        { type: 'miracle', title: 'Les noces de Cana', textFr: 'Texte.' },
        { type: 'prayer', title: 'x'.repeat(161), textFr: 'Amen.' },
        { type: 'virtue', title: 'Le courage', textFr: 'Courage.', gradeMin: '5', gradeMax: '2' },
        { type: 'virtue', title: 'La bonté', textFr: 'Bonté.', tags: ['Bonté', 'bonté'] },
        { type: 'virtue', title: 'La paix', textFr: 'Encore la paix.' },
        { type: 'reflection', title: 'Noël', textFr: 'Noël.', liturgicalSeason: 'été' },
        { type: 'virtue', title: 'La foi', textFr: 'Foi.', grade: '3' },
        'La patience',
      ]),
    );
    expect(formatProblems(problems).split('\n')).toEqual([
      '  reference 2 (virtue « La joie »), textFr: required',
      '  reference 3 (miracle « Les noces de Cana »), type: must be one of virtue, graduate_expectation, reflection, prayer, scripture',
      `  reference 4 (prayer « ${'x'.repeat(59)}… »), title: at most 160 characters`,
      '  reference 5 (virtue « Le courage »), gradeMax: comes before gradeMin',
      '  reference 6 (virtue « La bonté »), tags.1: this tag appears twice',
      '  reference 8 (reflection « Noël »), liturgicalSeason: must be null or one of avent, noel, careme, paques, temps_ordinaire',
      '  reference 9 (virtue « La foi »): unknown field grade',
      '  reference 10: must be an object: {"type", "title", "textFr", …}',
    ]);
  });

  it('refuses a text with a control character, and keeps line breaks', () => {
    expect(
      formatProblems(
        problemsOf(
          file([
            { type: 'prayer', title: 'Prière', textFr: 'Seigneur,\nmerci.\tAmen.' },
            { type: 'virtue', title: 'La paix\u0000', textFr: 'Paix.' },
          ]),
        ),
      ),
    ).toBe('  reference 2 (virtue « La paix\u0000 »), title: holds a control character');
  });

  it('refuses a type and title twice, naming both entries', () => {
    const problems = problemsOf(
      file([
        { type: 'virtue', title: 'La paix', textFr: 'Paix.' },
        { type: 'prayer', title: 'La paix', textFr: 'Une prière pour la paix.' },
        { type: 'virtue', title: 'La paix', textFr: 'Encore la paix.' },
      ]),
    );
    expect(formatProblems(problems)).toBe(
      '  reference 3 (virtue « La paix »), title: reference 1 has the same type and title (a board has one of each)',
    );
  });

  it('checks the file itself', () => {
    expect(problemsOf('{"references": [')).toEqual([
      { entry: null, field: '', message: 'the file is not valid JSON' },
    ]);
    expect(formatProblems(problemsOf([]))).toBe(
      '  (file): must be an object: {"sample", "official", "sourceNote", "references"}',
    );
    expect(formatProblems(problemsOf({ references: [], extra: 1 })).split('\n')).toEqual([
      '  sample: required',
      '  official: required',
      '  references: the file has no reference',
      '  (file): unknown field extra',
    ]);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      type: 'virtue',
      title: `Vertu ${i}`,
      textFr: 'Texte.',
    }));
    expect(formatProblems(problemsOf(file(tooMany)))).toBe(
      '  references: at most 500 references per file',
    );
  });

  it('lists 30 problems at most', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ type: 'virtue', title: `V${i}` }));
    const lines = formatProblems(problemsOf(file(entries))).split('\n');
    expect(lines).toHaveLength(31);
    expect(lines.at(-1)).toBe('  …and 10 more');
  });

  it('notes the typography to check, without refusing the file', () => {
    const { data } = parseReferencesFile(
      file([
        {
          type: 'reflection',
          title: "L'amitié",
          textFr: 'Pense à un ami : que fais-tu pour lui?',
          tags: ['amitié'],
        },
      ]),
    );
    expect(typographyNotes(data!)).toEqual([
      '  reference 1 (reflection « L\'amitié »), title: straightApostrophe "L\'a"',
      '  reference 1 (reflection « L\'amitié »), textFr: colonSpacing " :"',
    ]);
  });
});

describe('the report', () => {
  const report = (dryRun: boolean, counts: Partial<ReferencesReport['counts']> = {}) =>
    importReportSchema.parse({
      dryRun,
      counts: { created: 1, updated: 1, unchanged: 1, notInFile: 1, ...counts },
      references: [
        { type: 'virtue', title: 'La paix', outcome: 'create', changes: [] },
        {
          type: 'prayer',
          title: 'Prière du matin',
          outcome: 'update',
          changes: ['textFr', 'tags'],
        },
        { type: 'virtue', title: 'Le respect', outcome: 'unchanged', changes: [] },
      ],
      notInFile: [{ type: 'virtue', title: 'La patience', active: false }],
    });

  it('says what a dry run would change, and what it keeps', () => {
    expect(importText(report(true), 'refs.json', 'Conseil exemple')).toBe(
      [
        'Dry run: nothing was written. With --apply, refs.json would give Conseil exemple:',
        '3 references: 1 new, 1 updated, 1 unchanged.',
        '',
        '  new      virtue  « La paix »',
        '  updated  prayer  « Prière du matin » (textFr, tags)',
        '',
        'Not in the file, kept as they are (a file retires one with "active": false): 1',
        '  virtue  « La patience » (retired)',
        '',
        'Run the same command with --apply to import it.',
      ].join('\n'),
    );
  });

  it('says the import is in the board’s audit log, or that nothing changed', () => {
    expect(importText(report(false), 'refs.json', 'Conseil exemple')).toMatch(
      /^Imported refs\.json into Conseil exemple:\n[\s\S]*Recorded in the board’s audit log \(catholic_references\.imported\)\.$/,
    );
    const same = importReportSchema.parse({
      dryRun: true,
      counts: { created: 0, updated: 0, unchanged: 1, notInFile: 0 },
      references: [{ type: 'virtue', title: 'Le respect', outcome: 'unchanged', changes: [] }],
      notInFile: [],
    });
    expect(importText(same, 'refs.json', 'Conseil exemple')).toBe(
      [
        'Dry run: nothing was written. With --apply, refs.json would give Conseil exemple:',
        '1 reference: 0 new, 0 updated, 1 unchanged.',
        '',
        'Nothing to import: the board’s references already match the file.',
      ].join('\n'),
    );
    expect(importText({ ...same, dryRun: false }, 'refs.json', 'Conseil exemple')).toMatch(
      /Nothing was written: the board’s references already matched the file\.$/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// The command, against a fake of the API
// ---------------------------------------------------------------------------------------

const BOARD = { id: '22222222-2222-4222-8222-222222222222', name: 'Conseil exemple' };

interface Call {
  method: string;
  url: string;
  body: string;
}

/** A Supabase API with one board (`csc-exemple`) whose import reports every reference new. */
function fakeApi() {
  const calls: Call[] = [];
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    calls.push({ method: request.method, url: request.url, body });
    if (url.pathname === '/rest/v1/boards') {
      return json(url.searchParams.get('slug') === 'eq.csc-exemple' ? [BOARD] : []);
    }
    if (url.pathname === '/rest/v1/rpc/catholic_references_import') {
      const args = JSON.parse(body) as {
        p_references: { type: string; title: string }[];
        p_apply: boolean;
      };
      return json({
        dryRun: !args.p_apply,
        counts: { created: args.p_references.length, updated: 0, unchanged: 0, notInFile: 0 },
        references: args.p_references.map((r) => ({
          type: r.type,
          title: r.title,
          outcome: 'create',
          changes: [],
        })),
        notInFile: [],
      });
    }
    return new Response(null, { status: 404 });
  };
  const db = createClient<Database>('https://api.example.test', 'service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

async function run(argv: string[]) {
  const { command, values } = parseCli(argv);
  const { db, calls } = fakeApi();
  const ctx: CliContext = { values, env: {} as AdminEnv, db };
  let outcome: string | Error;
  try {
    outcome = await referenceCommands[command!]!(ctx);
  } catch (error) {
    outcome = error as Error;
  }
  return { outcome, calls };
}

/** Writes a file in a new temporary folder and returns its absolute path. */
function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lynx-references-'));
  const filePath = path.join(dir, name);
  writeFileSync(filePath, content);
  return filePath;
}

describe('import-references', () => {
  it('checks the options and the whole file before reaching the settings or the database', async () => {
    // No environment and no database: each fails before either is read.
    const bare = (argv: string[]) => {
      const { command, values } = parseCli(argv);
      return referenceCommands[command!]!(createContext(values));
    };
    await expect(bare(['import-references', '--file', SAMPLE])).rejects.toThrow(/--board/);
    await expect(bare(['import-references', '--board', 'csc-exemple'])).rejects.toThrow(/--file/);
    await expect(
      bare(['import-references', '--board', 'csc-exemple', '--file', '/nowhere/refs.json']),
    ).rejects.toThrow(/cannot read \/nowhere\/refs\.json/);

    const invalid = tempFile(
      'invalid.json',
      JSON.stringify(file([{ type: 'virtue', title: 'La joie' }])),
    );
    const refused = bare(['import-references', '--board', 'csc-exemple', '--file', invalid]);
    await expect(refused).rejects.toThrow(CliError);
    await expect(refused).rejects.toThrow(
      /is not a valid Catholic references file \(1 problem; nothing was written\):\n {2}reference 1 \(virtue « La joie »\), textFr: required$/,
    );

    const official = tempFile('official.json', JSON.stringify(file(undefined, { official: true })));
    await expect(
      bare(['import-references', '--board', 'csc-exemple', '--file', official]),
    ).rejects.toThrow(REFERENCES_LICENCE_WARNING);
  });

  it('refuses an unknown board', async () => {
    const { outcome, calls } = await run([
      'import-references',
      '--board',
      'csc-x',
      '--file',
      SAMPLE,
    ]);
    expect(outcome).toBeInstanceOf(CliError);
    expect((outcome as Error).message).toBe('board "csc-x": not found');
    expect(calls.some((c) => c.url.includes('/rpc/'))).toBe(false);
  });

  it('reads a file saved with a byte order mark', async () => {
    const withBom = tempFile('bom.json', `\uFEFF${JSON.stringify(file())}`);
    const { outcome } = await run([
      'import-references',
      '--board',
      'csc-exemple',
      '--file',
      withBom,
    ]);
    expect(outcome).toMatch(/2 references: 2 new/);
  });

  it('is a dry run by default, and sends every reference with the file’s fingerprint', async () => {
    const { outcome, calls } = await run([
      'import-references',
      '--board',
      'csc-exemple',
      '--file',
      SAMPLE,
    ]);
    expect(typeof outcome).toBe('string');
    const text = outcome as string;
    expect(text.startsWith(`${SAMPLE_NOTE}\n`)).toBe(true);
    expect(text).toMatch(/Fingerprint [0-9a-f]{12} \(SHA-256 of .*sample\.json\)\./);
    expect(text).toMatch(/Dry run: nothing was written\./);
    expect(text).toMatch(/Run the same command with --apply to import it\.$/);

    const rpc = calls.find((c) => c.url.endsWith('/rest/v1/rpc/catholic_references_import'))!;
    expect(rpc.method).toBe('POST');
    const args = JSON.parse(rpc.body) as Record<string, unknown>;
    expect(args).toMatchObject({ p_board_id: BOARD.id, p_apply: false });
    expect(args.p_file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_references).toEqual(referenceRows(parseReferencesFile(sampleJson()).data!));
  });

  it('imports with --apply, and prints the licence it confirmed', async () => {
    const official = tempFile('official.json', JSON.stringify(file(undefined, { official: true })));
    const { outcome, calls } = await run([
      'import-references',
      '--board',
      'csc-exemple',
      '--file',
      official,
      '--apply',
      '--confirm-licence',
    ]);
    const text = outcome as string;
    expect(
      text.startsWith(`Licence confirmed with --confirm-licence.\n${REFERENCES_LICENCE_WARNING}`),
    ).toBe(true);
    expect(text).toMatch(/Imported .*official\.json into Conseil exemple:\n2 references: 2 new/);
    const rpc = calls.find((c) => c.url.endsWith('/rpc/catholic_references_import'))!;
    expect(JSON.parse(rpc.body)).toMatchObject({ p_apply: true });
  });
});
