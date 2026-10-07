/**
 * Catholic references (DECISIONS D-058, D-146): a board's references for the plans' « Moment de
 * foi », the library's « Ajouter un lien avec la foi » and the faith moment of « Info-parents »,
 * loaded from one JSON file. A dry run unless --apply; the board's IT guide is
 * docs/catholic-references.md, and content/catholic-references/sample.json is an example
 * (fictional, to check).
 *
 *   pnpm admin import-references --board <slug> --file references.json [--apply] [--confirm-licence]
 *
 * Every entry is checked here first (`referencesFileSchema`), and the problems name the entry.
 * The database then matches each one with the board's reference of the same type and title,
 * creates, updates or leaves it, and keeps the board's other references; the whole file is one
 * transaction (`catholic_references_import`), and the dry run makes the same writes and rolls
 * them back. A file that says its texts are copied from a published source needs
 * --confirm-licence (D-030). Re-running the same file changes nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { frenchStyleProblems, GRADE_CODE_PATTERN } from '@lynx/content';
import { catholicReferenceTypes, liturgicalSeasons } from '@lynx/domain';
import { z } from 'zod';
import {
  boardBySlug,
  CliError,
  need,
  operatorPath,
  type CliContext,
  type Command,
} from '../context';

/** At most this many references per file (a board has a few dozen). */
export const MAX_REFERENCES = 500;
export const MAX_TAGS = 12;

export const REFERENCES_LICENCE_WARNING =
  'This file says its texts are copied from a published source: a Bible or liturgical ' +
  'translation, a book of prayers, or the Catholic graduate expectations. Those texts belong to ' +
  'their publishers and to Catholic education bodies, and may only be loaded into a commercial ' +
  'product once the permission is confirmed (DECISIONS D-030). Re-run with --confirm-licence ' +
  'only if it is.';

export const SAMPLE_NOTE =
  'This file is a sample: its references are fictional or paraphrased examples. Check every one ' +
  'with the board before teachers see them, or load the board’s own file instead.';

/** Grade codes as the database orders them (K1 = -1, K2 = 0, 1re…8e = 1…8). */
const GRADE_ORDINAL: Readonly<Record<string, number>> = {
  K1: -1,
  K2: 0,
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), n])),
};

// ---------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------

/** « required » when the field is missing, `what` when it has the wrong kind of value. */
const kind = (what: string) => ({
  error: (issue: { input?: unknown }) => (issue.input === undefined ? 'required' : what),
});

/** A control character other than a line break or a tab (the database refuses U+0000). */
const hasControlCharacter = (text: string) =>
  [...text].some((c) => {
    const code = c.charCodeAt(0);
    return (code < 32 && c !== '\n' && c !== '\r' && c !== '\t') || code === 127;
  });

const requiredText = (max: number) =>
  z
    .string(kind('must be text'))
    .trim()
    .min(1, 'required')
    .max(max, `at most ${max} characters`)
    .refine((text) => !hasControlCharacter(text), 'holds a control character');

/** Text or null; an empty text is null. */
const optionalText = (max: number) =>
  z
    .string(kind('must be text or null'))
    .trim()
    .max(max, `at most ${max} characters`)
    .refine((text) => !hasControlCharacter(text), 'holds a control character')
    .nullable()
    .transform((text) => text || null);

const gradeCode = z
  .string(kind('must be a grade code: K1, K2 or 1 to 8'))
  .regex(GRADE_CODE_PATTERN, 'must be a grade code: K1, K2 or 1 to 8');

export const referenceEntrySchema = z
  .strictObject(
    {
      type: z.enum(
        catholicReferenceTypes,
        kind(`must be one of ${catholicReferenceTypes.join(', ')}`),
      ),
      title: requiredText(160),
      textFr: requiredText(4000),
      textEn: optionalText(4000).default(null),
      /** The grades the reference suits, inclusive: every grade by default. */
      gradeMin: gradeCode.default('K1'),
      gradeMax: gradeCode.default('8'),
      /** Null: any time of the year. */
      liturgicalSeason: z
        .enum(liturgicalSeasons, kind(`must be null or one of ${liturgicalSeasons.join(', ')}`))
        .nullable()
        .default(null),
      /** Words matched against a plan day's lessons and a resource's subject (D-058, D-074). */
      tags: z
        .array(requiredText(40), kind('must be a list of words'))
        .max(MAX_TAGS, `at most ${MAX_TAGS} tags`)
        .default([]),
      /** Missing: the file's `sourceNote`; null: none. */
      sourceNote: optionalText(500).optional(),
      /** False retires the reference: plans and the library no longer offer it. */
      active: z.boolean(kind('must be true or false')).default(true),
    },
    kind('must be an object: {"type", "title", "textFr", …}'),
  )
  .superRefine((entry, ctx) => {
    if (GRADE_ORDINAL[entry.gradeMax]! < GRADE_ORDINAL[entry.gradeMin]!) {
      ctx.addIssue({ code: 'custom', path: ['gradeMax'], message: 'comes before gradeMin' });
    }
    const seen = new Set<string>();
    entry.tags.forEach((tag, i) => {
      const folded = tag.toLowerCase();
      if (seen.has(folded)) {
        ctx.addIssue({ code: 'custom', path: ['tags', i], message: 'this tag appears twice' });
      }
      seen.add(folded);
    });
  });

export const referencesFileSchema = z
  .strictObject(
    {
      /** Fictional or paraphrased examples (the CLI says so before anything else). */
      sample: z.boolean(kind('must be true or false')),
      /** The texts are copied from a published source: needs --confirm-licence (D-030). */
      official: z.boolean(kind('must be true or false')),
      /** For the teachers: where the texts come from. Each entry may give its own. */
      sourceNote: optionalText(500).default(null),
      references: z
        .array(referenceEntrySchema, kind('must be a list of references'))
        .min(1, 'the file has no reference')
        .max(MAX_REFERENCES, `at most ${MAX_REFERENCES} references per file`),
    },
    kind('must be an object: {"sample", "official", "sourceNote", "references"}'),
  )
  .superRefine((file, ctx) => {
    const first = new Map<string, number>();
    file.references.forEach((entry, i) => {
      const key = `${entry.type}\u0000${entry.title}`;
      const earlier = first.get(key);
      if (earlier === undefined) first.set(key, i);
      else {
        ctx.addIssue({
          code: 'custom',
          path: ['references', i, 'title'],
          message: `reference ${earlier + 1} has the same type and title (a board has one of each)`,
        });
      }
    });
  });
export type ReferencesFile = z.output<typeof referencesFileSchema>;

export interface ReferencesProblem {
  /** The entry, as the operator finds it in the file: « reference 3 (virtue « Le respect ») ». */
  entry: string | null;
  /** The field, inside the entry or the file (`textFr`, `tags.2`); '' for the whole entry. */
  field: string;
  message: string;
}

const quote = (text: string) => `« ${text} »`;

/** How a problem names its entry: its number in the file and, when it has them, type and title. */
function entryName(raw: unknown, index: number): string {
  const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : null;
  const type = typeof entry.type === 'string' ? entry.type : null;
  const what = [type, title && quote(title.length > 60 ? `${title.slice(0, 59)}…` : title)]
    .filter(Boolean)
    .join(' ');
  return `reference ${index + 1}${what ? ` (${what})` : ''}`;
}

/**
 * Validates an import file (JSON text or an already parsed value). `data` is null whenever there
 * is a problem; each problem names its entry by number, type and title.
 */
export function parseReferencesFile(json: unknown): {
  data: ReferencesFile | null;
  problems: ReferencesProblem[];
} {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch {
      return {
        data: null,
        problems: [{ entry: null, field: '', message: 'the file is not valid JSON' }],
      };
    }
  }
  const parsed = referencesFileSchema.safeParse(value);
  if (parsed.success) return { data: parsed.data, problems: [] };
  const rawEntries =
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { references?: unknown }).references)
      ? (value as { references: unknown[] }).references
      : [];
  return {
    data: null,
    problems: parsed.error.issues.map((issue) => {
      const message =
        issue.code === 'unrecognized_keys'
          ? `unknown field${issue.keys.length === 1 ? '' : 's'} ${issue.keys.join(', ')}`
          : issue.message;
      const [top, index, ...rest] = issue.path.map(String);
      if (top === 'references' && index !== undefined && /^\d+$/.test(index)) {
        const i = Number(index);
        return { entry: entryName(rawEntries[i], i), field: rest.join('.'), message };
      }
      return { entry: null, field: issue.path.map(String).join('.'), message };
    }),
  };
}

/** One line per problem (the first 30), for the operator. */
export function formatProblems(problems: readonly ReferencesProblem[]): string {
  const lines = problems.slice(0, 30).map((p) => {
    const where = [p.entry, p.field].filter(Boolean).join(', ') || '(file)';
    return `  ${where}: ${p.message}`;
  });
  if (problems.length > 30) lines.push(`  …and ${problems.length - 30} more`);
  return lines.join('\n');
}

/** What `catholic_references_import` receives: every field, the source note resolved. */
export function referenceRows(file: ReferencesFile) {
  return file.references.map((entry) => ({
    type: entry.type,
    title: entry.title,
    textFr: entry.textFr,
    textEn: entry.textEn,
    gradeMin: entry.gradeMin,
    gradeMax: entry.gradeMax,
    liturgicalSeason: entry.liturgicalSeason,
    tags: entry.tags,
    sourceNote: entry.sourceNote === undefined ? file.sourceNote : entry.sourceNote,
    active: entry.active,
  }));
}

/**
 * Typography to check (not blocking): straight apostrophes, spaces around « » and before `:`,
 * European words (`frenchStyleProblems`), in each French title, text and tag.
 */
export function typographyNotes(file: ReferencesFile): string[] {
  const notes: string[] = [];
  file.references.forEach((entry, i) => {
    const fields: [string, string][] = [
      ['title', entry.title],
      ['textFr', entry.textFr],
      ...entry.tags.map((tag, t): [string, string] => [`tags.${t}`, tag]),
    ];
    for (const [field, text] of fields) {
      const found = frenchStyleProblems(text);
      if (found.length) {
        const what = [...new Set(found.map((p) => `${p.code} ${JSON.stringify(p.match)}`))].join(
          ', ',
        );
        notes.push(`  ${entryName(entry, i)}, ${field}: ${what}`);
      }
    }
  });
  return notes;
}

// ---------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------

/** What `catholic_references_import` returns. */
export const importReportSchema = z.object({
  dryRun: z.boolean(),
  counts: z.object({
    created: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    notInFile: z.number(),
  }),
  references: z.array(
    z.object({
      type: z.string(),
      title: z.string(),
      outcome: z.enum(['create', 'update', 'unchanged']),
      changes: z.array(z.string()),
    }),
  ),
  notInFile: z.array(z.object({ type: z.string(), title: z.string(), active: z.boolean() })),
});
export type ReferencesReport = z.output<typeof importReportSchema>;

const OUTCOME_LABELS: Record<ReferencesReport['references'][number]['outcome'], string> = {
  create: 'new',
  update: 'updated',
  unchanged: 'unchanged',
};

/** The dry run's or the import's report, for the operator. */
export function importText(r: ReferencesReport, file: string, board: string): string {
  const c = r.counts;
  const total = r.references.length;
  const counts =
    `${total} reference${total === 1 ? '' : 's'}: ${c.created} new, ${c.updated} updated, ` +
    `${c.unchanged} unchanged.`;
  const out = [
    r.dryRun
      ? `Dry run: nothing was written. With --apply, ${file} would give ${board}:`
      : `Imported ${file} into ${board}:`,
    counts,
  ];
  const listed = r.references.filter((ref) => ref.outcome !== 'unchanged');
  if (listed.length) {
    out.push('');
    for (const ref of listed) {
      const changes = ref.changes.length ? ` (${ref.changes.join(', ')})` : '';
      out.push(
        `  ${OUTCOME_LABELS[ref.outcome].padEnd(7)}  ${ref.type}  ${quote(ref.title)}${changes}`,
      );
    }
  }
  if (r.notInFile.length) {
    out.push(
      '',
      `Not in the file, kept as they are (a file retires one with "active": false): ${r.notInFile.length}`,
    );
    for (const ref of r.notInFile.slice(0, 30)) {
      out.push(`  ${ref.type}  ${quote(ref.title)}${ref.active ? '' : ' (retired)'}`);
    }
    if (r.notInFile.length > 30) out.push(`  …and ${r.notInFile.length - 30} more`);
  }
  const written = c.created + c.updated > 0;
  if (r.dryRun) {
    out.push(
      '',
      written
        ? 'Run the same command with --apply to import it.'
        : 'Nothing to import: the board’s references already match the file.',
    );
  } else {
    out.push(
      '',
      written
        ? 'Recorded in the board’s audit log (catholic_references.imported).'
        : 'Nothing was written: the board’s references already matched the file.',
    );
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------

/** The file and its checks, before the database is reached. */
export function readReferencesFile(
  given: string,
  options: { confirmLicence: boolean },
): { data: ReferencesFile; sha256: string; notices: string[] } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(operatorPath(given));
  } catch {
    throw new CliError(`cannot read ${given}`);
  }
  // A file saved by some Windows editors starts with a byte order mark: not part of the JSON.
  const { data, problems } = parseReferencesFile(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!data) {
    throw new CliError(
      `${given} is not a valid Catholic references file (${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing was written):\n${formatProblems(problems)}`,
    );
  }
  if (data.official && !options.confirmLicence) throw new CliError(REFERENCES_LICENCE_WARNING);
  const notices: string[] = [];
  // Confirmed: the warning is still printed, so the operator sees what they confirmed.
  if (data.official)
    notices.push(`Licence confirmed with --confirm-licence.\n${REFERENCES_LICENCE_WARNING}`);
  if (data.sample) notices.push(SAMPLE_NOTE);
  const typography = typographyNotes(data);
  if (typography.length) {
    notices.push(
      [
        `Typography to check (not blocking; « » and : take no-break spaces, apostrophes are ’):`,
        ...typography.slice(0, 20),
        ...(typography.length > 20 ? [`  …and ${typography.length - 20} more`] : []),
      ].join('\n'),
    );
  }
  return { data, sha256: createHash('sha256').update(bytes).digest('hex'), notices };
}

async function importReferences(ctx: CliContext): Promise<string> {
  // Every option and the whole file are checked before the database is reached.
  const boardSlug = need(ctx, 'board');
  const given = need(ctx, 'file');
  const { data, sha256, notices } = readReferencesFile(given, {
    confirmLicence: ctx.values['confirm-licence'] === true,
  });

  const board = await boardBySlug(ctx, boardSlug);
  const { data: result, error } = await ctx.db.rpc('catholic_references_import', {
    p_board_id: board.id,
    p_references: referenceRows(data),
    p_file_sha256: sha256,
    p_apply: ctx.values.apply === true,
  });
  if (error) throw new CliError(`${ctx.values.apply ? 'import' : 'dry run'}: ${error.message}`);
  const report = importReportSchema.parse(result);
  return [
    ...notices.map((notice) => `${notice}\n`),
    `Fingerprint ${sha256.slice(0, 12)} (SHA-256 of ${given}).`,
    importText(report, given, board.name),
  ].join('\n');
}

export const referenceCommands: Record<string, Command> = {
  'import-references': importReferences,
};
