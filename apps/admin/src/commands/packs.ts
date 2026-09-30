/**
 * Content packs, format v1 (DECISIONS D-099, D-100; slice S7): export a board's approved
 * resources to one JSON file, and import one into a board (staged, previewed as a dry run by
 * default, applied in one transaction with --apply; imported resources wait, private, in the
 * board's approval queue). Pack files hold answer keys: treat them as confidential and never
 * host them publicly. docs/content-packs.md is the guide for a board's IT.
 *
 *   pnpm admin export-pack --board csc-demo --slug lynx-fra-3e --version 2026.2 --title "…"
 *     --publisher "IP Lynx" --licence "…" [--no-derivatives] [--grade 3] [--subject fra]
 *     [--include-teacher-items] [--include-pack-items] [--allow-names "Marie,Joseph"] --out pack.json
 *   pnpm admin import-pack --board <slug> --file pack.json [--level-map debutant=debutant,…]
 *     [--apply] [--approve --approver <email>]
 *   pnpm admin list-packs --board <slug>
 *
 * --grade and --subject take a code or a comma-separated list. Export: the board's approved
 * resources that are its own (from its own publisher's packs too), and with the flags, teachers'
 * approved resources (credited to the board only) and other publishers' pack resources. Every
 * text of a resource is checked for the first names of the board's students and the names of its
 * staff, and for personal details: a resource with one is left out and reported (--allow-names
 * lists words that are not people: saints, apostles…). Import: `--level-map pack=board` when the
 * pack's level codes differ from the board's; `--approve --approver` approves the ready
 * resources in the same transaction, never faith content, experiments, STEM challenges or
 * outdoor activities.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Redactor, type BlockedKind, type KnownPerson } from '@lynx/ai/privacy';
import {
  assemblePack,
  contentPackItemSchema,
  GRADE_CODE_PATTERN,
  PACK_VERSION_PATTERN,
  packExportPageSchema,
  packItemFromExport,
  packItemSuggestsFaith,
  packItemTexts,
  packTagsFromExport,
  SLUG_PATTERN,
  validatePack,
  type ContentPack,
  type ContentPackItem,
  type PackExportRow,
  type PackLevel,
  type PackProblem,
} from '@lynx/content';
import type { Json } from '@lynx/db';
import { z } from 'zod';
import { boardBySlug, CliError, need, type CliContext, type Command } from '../context';

/** How many items `content_pack_stage_items` takes per call. */
export const STAGE_CHUNK = 50;
const LEVEL_CODE = /^[a-z0-9_]{2,32}$/;
const SUBJECT_CODE = /^[a-z0-9_]{2,32}$/;

// ---------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------

/**
 * `--level-map debutant=niveau_1,avance=niveau_3`: the pack's level code, then the board's. An
 * empty value maps nothing (each level keeps its code).
 */
export function parseLevelMap(value: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of (value ?? '').split(',')) {
    const pair = part.trim();
    if (!pair) continue;
    const [from, to, ...rest] = pair.split('=').map((s) => s.trim());
    if (rest.length || !from || !to || !LEVEL_CODE.test(from) || !LEVEL_CODE.test(to)) {
      throw new CliError(
        `--level-map: « ${pair} » must look like pack_code=board_code (lowercase letters, digits and _)`,
      );
    }
    if (from in map) throw new CliError(`--level-map: ${from} is mapped twice`);
    map[from] = to;
  }
  return map;
}

/** Folded for comparison: lowercase, no accents. */
export function foldName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * `--allow-names "Marie, Joseph,Pierre"`: words the operator confirms are not people in these
 * resources (saints, apostles…). Each once, in the order given.
 */
export function parseAllowNames(value: string | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of (value ?? '').split(',')) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > 80) throw new CliError('--allow-names: a name has at most 80 characters');
    const folded = foldName(name);
    if (!seen.has(folded)) {
      seen.add(folded);
      names.push(name);
    }
  }
  return names;
}

/** `--grade 3,5` or `--subject fra,mat`: codes, each once. */
export function parseCodes(value: string | undefined, option: string, pattern: RegExp): string[] {
  const codes: string[] = [];
  for (const part of (value ?? '').split(',')) {
    const code = part.trim();
    if (!code) continue;
    if (!pattern.test(code)) throw new CliError(`--${option}: « ${code} » is not a code`);
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

// ---------------------------------------------------------------------------------------
// The export's name check (D-099)
// ---------------------------------------------------------------------------------------

export interface NameFinding {
  key: string;
  title: string;
  /** Names found, as the text writes them (the student's first name, the staff member's name). */
  names: string[];
  /** Personal details found (e-mail, phone…). */
  details: BlockedKind[];
}

/**
 * The items that name one of the board's students or staff, or hold a personal detail, in any of
 * their texts (`packItemTexts`). Names the operator allowed are not findings.
 */
export function findPeople(
  items: readonly ContentPackItem[],
  people: readonly KnownPerson[],
  allowed: readonly string[],
): NameFinding[] {
  const allow = new Set(allowed.map(foldName));
  const findings: NameFinding[] = [];
  for (const item of items) {
    // One redactor per item: its replacements are this item's names, as written first.
    const redactor = new Redactor(people);
    const details = new Set<BlockedKind>();
    for (const text of packItemTexts(item)) {
      for (const finding of redactor.redact(text).blocked) details.add(finding.kind);
    }
    const names = [
      ...new Set(
        redactor
          .replacements()
          .map((r) => r.original)
          .filter((name) => !allow.has(foldName(name))),
      ),
    ];
    if (names.length || details.size) {
      findings.push({ key: item.key, title: item.title, names, details: [...details] });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------

const quote = (text: string) => `« ${text} »`;

export interface ExportSummary {
  board: string;
  out: string;
  pack: ContentPack;
  bytes: number;
  sha256: string;
  /** Items left out for a name or a personal detail. */
  people: NameFinding[];
  /** Items left out because they are not valid pack items. */
  invalid: { key: string; title: string; problems: PackProblem[] }[];
  teacherItems: boolean;
}

export function exportText(s: ExportSummary): string {
  const out = [
    `Exported ${s.pack.items.length} resource${s.pack.items.length === 1 ? '' : 's'} of ${s.board} ` +
      `to ${s.out}: pack ${s.pack.pack.slug} ${s.pack.pack.version} ${quote(s.pack.pack.title)}, ` +
      `publisher ${s.pack.pack.publisher}, ${s.bytes} bytes.`,
    `SHA-256 ${s.sha256} (fingerprint ${s.sha256.slice(0, 12)}).`,
  ];
  if (s.people.length) {
    out.push(
      '',
      `Left out: ${s.people.length} resource${s.people.length === 1 ? '' : 's'} naming someone of the board or holding a personal detail.`,
      'Check each one; words that are not people (saints, apostles…) go in --allow-names.',
    );
    for (const f of s.people) {
      const found = [...f.names, ...f.details.map((d) => `(${d})`)].join(', ');
      out.push(`  ${f.key}  ${quote(f.title)}: ${found}`);
    }
  }
  if (s.invalid.length) {
    out.push(
      '',
      `Left out: ${s.invalid.length} resource${s.invalid.length === 1 ? '' : 's'} that a pack cannot carry as they are (fix them in the app):`,
    );
    for (const f of s.invalid) {
      const problems = f.problems
        .slice(0, 5)
        .map((p) => `${p.path || '(item)'} ${p.message}`)
        .join('; ');
      out.push(`  ${f.key}  ${quote(f.title)}: ${problems}${f.problems.length > 5 ? '; …' : ''}`);
    }
  }
  if (s.teacherItems) {
    out.push(
      '',
      'Warning: --include-teacher-items adds resources written by teachers. They are credited to ' +
        'the board only, never by name. Confirm who owns them and how they may be shared before ' +
        'this pack leaves the board.',
    );
  }
  out.push('', 'The file holds answer keys: keep it confidential and never host it publicly.');
  return out.join('\n');
}

/** A report item of `content_pack_preview` or `content_pack_apply`. */
const reportItemSchema = z.object({
  key: z.string(),
  type: z.string().nullable(),
  title: z.string().nullable(),
  outcome: z.enum([
    'create',
    'update',
    'unchanged',
    'changed_not_applied',
    'skipped_modified_locally',
    'skipped_deleted_locally',
    'skipped_unresolved',
  ]),
  status: z.string().nullable(),
  queued: z.boolean(),
  approved: z.boolean(),
  warnings: z.array(z.string()),
});

export const importReportSchema = z.object({
  dryRun: z.boolean(),
  pack: z.object({
    slug: z.string(),
    version: z.string(),
    title: z.string(),
    publisher: z.string(),
  }),
  fileSha256: z.string(),
  approverOk: z.boolean().nullable(),
  counts: z.object({
    created: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    changedNotApplied: z.number(),
    skippedModifiedLocally: z.number(),
    /** Reports written before the Phase 5 hardening have no such count. */
    skippedDeletedLocally: z.number().default(0),
    skippedUnresolved: z.number(),
    queued: z.number(),
    approved: z.number(),
    drafts: z.number(),
    notInPack: z.number(),
  }),
  items: z.array(reportItemSchema),
  notInPack: z.array(z.string()),
  newTags: z.array(z.string()),
  droppedTags: z.array(z.string()),
});
export type ImportReport = z.output<typeof importReportSchema>;

const OUTCOME_LABELS: Record<ImportReport['items'][number]['outcome'], string> = {
  create: 'new',
  update: 'updated',
  unchanged: 'unchanged',
  changed_not_applied: 'changed, not applied',
  skipped_modified_locally: 'modified here, kept',
  skipped_deleted_locally: 'deleted here, not re-created',
  skipped_unresolved: 'skipped',
};

/** A warning code of the database's report as a sentence for the operator. */
export function warningText(code: string): string {
  const [name, ...rest] = code.split(':');
  const detail = rest.join(':');
  switch (name) {
    case 'levelSkipped':
      return `version for level ${detail} skipped: the board has no such level (use --level-map)`;
    case 'notReady':
      return `stays a draft: not ready for approval (${detail})`;
    case 'expectationUnknown':
      return `attente not found (curriculum version, grade, code): ${detail}`;
    case 'referenceUnknown':
      return 'Catholic reference not found: not linked';
    case 'referenceAmbiguous':
      return 'the board has several Catholic references with this title: not linked';
    case 'tagDropped':
      return `tag ${detail} dropped (at most 30 new tags per import)`;
    case 'gradeUnknown':
      return `unknown grade ${detail}`;
    case 'subjectUnknown':
      return `unknown subject ${detail}`;
    case 'typeUnknown':
      return 'unknown resource type';
    case 'typeChanged':
      return 'the type changed since the version imported here';
    case 'baseMissing':
      return 'no base version for this board';
    case 'invalid':
      return 'a field the database refuses';
    case 'approvalFaithReview':
      return 'not approved: faith content is faith-reviewed first';
    case 'approvalByReviewer':
      return 'not approved: experiments, STEM challenges and outdoor activities need a reviewer';
    default:
      return code;
  }
}

export function importText(r: ImportReport, file: string): string {
  const c = r.counts;
  const out = [
    r.dryRun
      ? `Dry run: nothing was written. With --apply, ${file} would give:`
      : `Imported ${file}:`,
    `Pack ${r.pack.slug} ${r.pack.version} ${quote(r.pack.title)}, declared publisher ${r.pack.publisher}, ` +
      `fingerprint ${r.fileSha256.slice(0, 12)}.`,
    `${r.items.length} resources: ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged, ` +
      `${c.changedNotApplied} changed but not applied, ${c.skippedModifiedLocally} modified here and kept, ` +
      `${c.skippedDeletedLocally ? `${c.skippedDeletedLocally} deleted here and not re-created, ` : ''}` +
      `${c.skippedUnresolved} skipped.`,
    `Waiting for approval: ${c.queued}${c.approved ? ` (approved: ${c.approved})` : ''}; drafts: ${c.drafts}.`,
  ];
  if (r.approverOk === false) {
    out.push(
      'The approver is not one of the board’s content reviewers: nothing would be approved.',
    );
  }
  if (r.newTags.length) out.push(`New tags: ${r.newTags.join(', ')}.`);
  if (r.droppedTags.length) {
    out.push(`Tags dropped (at most 30 new per import): ${r.droppedTags.join(', ')}.`);
  }
  const listed = r.items.filter((i) => i.outcome !== 'unchanged' || i.warnings.length);
  if (listed.length) {
    out.push('');
    const width = Math.max(...listed.map((i) => i.key.length));
    for (const item of listed) {
      const state = item.approved
        ? 'approved'
        : item.queued
          ? 'waiting for approval'
          : item.outcome === 'create' || item.outcome === 'update'
            ? 'draft'
            : null;
      out.push(
        `  ${item.key.padEnd(width)}  ${OUTCOME_LABELS[item.outcome]}${state ? `, ${state}` : ''}` +
          `  ${quote(item.title ?? '')}`,
      );
      for (const w of item.warnings) out.push(`  ${' '.repeat(width)}    - ${warningText(w)}`);
    }
  }
  if (r.notInPack.length) {
    out.push(
      '',
      `Not in this version (kept as they are; archive them in the app if they should go): ${r.notInPack.join(', ')}.`,
    );
  }
  if (c.changedNotApplied) {
    out.push(
      '',
      '« Changed, not applied »: the pack changed a resource that is approved or archived here. ' +
        'It is never replaced; a reviewer compares and edits it if needed.',
    );
  }
  if (c.skippedModifiedLocally) {
    out.push(
      '',
      '« Modified here, kept »: someone edited the resource since it was imported; local edits win.',
    );
  }
  if (c.skippedDeletedLocally) {
    out.push(
      '',
      '« Deleted here, not re-created »: a reviewer deleted the resource after an earlier version ' +
        'imported it; later versions never bring it back (docs/content-packs.md says how to).',
    );
  }
  if (r.dryRun) out.push('', 'Run the same command with --apply to import it.');
  return out.join('\n');
}

const listSchema = z.array(
  z.object({
    slug: z.string(),
    version: z.string(),
    title: z.string(),
    publisher: z.string().nullable(),
    importedAt: z.string(),
    itemCount: z.number(),
    items: z.number(),
    fileSha256: z.string().nullable(),
    approvedBy: z.string().nullable(),
    report: z
      .object({
        counts: z.record(z.string(), z.number()).optional(),
        changedNotApplied: z.array(z.string()).optional(),
      })
      .nullable(),
  }),
);
export type PackListing = z.output<typeof listSchema>;

export function listText(board: string, packs: PackListing): string {
  if (!packs.length) return `${board}: no content pack.`;
  const out = [`${board}: ${packs.length} content pack${packs.length === 1 ? '' : 's'}`];
  for (const p of packs) {
    const date = p.importedAt.slice(0, 10);
    const counts = p.report?.counts;
    out.push(
      `  ${p.slug} ${p.version}  ${quote(p.title)}  ${p.publisher ?? '—'}  imported ${date}` +
        `${p.fileSha256 ? `  fingerprint ${p.fileSha256.slice(0, 12)}` : '  (seed)'}` +
        `  ${p.items} resource${p.items === 1 ? '' : 's'} from this version`,
    );
    if (counts) {
      out.push(
        `    ${counts.created ?? 0} new, ${counts.updated ?? 0} updated, ${counts.unchanged ?? 0} unchanged, ` +
          `${counts.changedNotApplied ?? 0} changed but not applied, ${counts.skippedModifiedLocally ?? 0} modified here, ` +
          `${counts.skippedDeletedLocally ? `${counts.skippedDeletedLocally} deleted here, ` : ''}` +
          `${counts.skippedUnresolved ?? 0} skipped${p.approvedBy ? `; approved by ${p.approvedBy}` : ''}`,
      );
    }
    if (p.report?.changedNotApplied?.length) {
      out.push(`    changed, not applied: ${p.report.changedNotApplied.join(', ')}`);
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// Database errors
// ---------------------------------------------------------------------------------------

/** A database error as the operator reads it (LXP… codes, D-100). */
export function packError(error: { code?: string; message: string }, what: string): CliError {
  switch (error.code) {
    case 'LXP01':
      return new CliError(
        `${what}: this version of the pack is already applied to the board (LXP01).`,
      );
    case 'LXP02':
      return new CliError(`${what}: a later version of the pack is applied to the board (LXP02).`);
    case 'LXP03':
      return new CliError(
        `${what}: the import is no longer staged (LXP03). Run the command again.`,
      );
    case 'LXP04':
      return new CliError(
        `${what}: the approver is not one of the board’s content reviewers (LXP04). ` +
          'See `pnpm admin list-library-reviewers`.',
      );
    case 'LXP05':
      return new CliError(`${what}: not every item was staged (LXP05). Run the command again.`);
    default:
      return new CliError(`${what}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

/** A path the operator typed, from where the command was typed (pnpm runs in apps/admin). */
function operatorPath(given: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
}

async function boardPeople(ctx: CliContext, boardId: string): Promise<KnownPerson[]> {
  const { data, error } = await ctx.db.rpc('content_pack_people', { p_board_id: boardId });
  if (error) throw new CliError(`people of the board: ${error.message}`);
  const people = z
    .object({ students: z.array(z.string()), staff: z.array(z.string()) })
    .parse(data);
  // Students first: a name that is both is looked for as a student's.
  return [
    ...people.students.map((name) => ({ name, kind: 'student' as const })),
    ...people.staff.map((name) => ({ name, kind: 'staff' as const })),
  ];
}

async function exportPack(ctx: CliContext): Promise<string> {
  // Every option is checked before the database is reached.
  const boardSlug = need(ctx, 'board');
  const slug = need(ctx, 'slug');
  if (!SLUG_PATTERN.test(slug)) {
    throw new CliError('--slug: lowercase letters and digits, words joined by hyphens');
  }
  const version = need(ctx, 'version');
  if (!PACK_VERSION_PATTERN.test(version)) {
    throw new CliError(
      '--version must look like 2026.2 (a year, a dot and a number, no leading zero)',
    );
  }
  const title = need(ctx, 'title');
  if (title.length > 160) throw new CliError('--title has at most 160 characters');
  const publisher = need(ctx, 'publisher');
  if (publisher.length > 120) throw new CliError('--publisher has at most 120 characters');
  const licence = ctx.values.licence?.trim() ?? '';
  if (licence.length > 500) throw new CliError('--licence has at most 500 characters');
  const out = operatorPath(need(ctx, 'out'));
  const gradeCodes = parseCodes(ctx.values.grade?.toUpperCase(), 'grade', GRADE_CODE_PATTERN);
  const subjectCodes = parseCodes(ctx.values.subject?.toLowerCase(), 'subject', SUBJECT_CODE);
  const allowed = parseAllowNames(ctx.values['allow-names']);
  const teacherItems = Boolean(ctx.values['include-teacher-items']);
  const noDerivatives = Boolean(ctx.values['no-derivatives']);

  const board = await boardBySlug(ctx, boardSlug);
  const boardId = board.id;
  const filters = {
    slug,
    publisher,
    includeTeacherItems: teacherItems,
    includePackItems: Boolean(ctx.values['include-pack-items']),
    gradeCodes,
    subjectCodes,
  };
  const rows: PackExportRow[] = [];
  let levels: PackLevel[] = [];
  let after: string | null = null;
  do {
    const { data, error } = await ctx.db.rpc('content_pack_export_items', {
      p_board_id: boardId,
      p_filters: filters,
      // Null on the first page (the generated types cannot know).
      p_after: after as string,
      p_limit: 100,
    });
    if (error) throw new CliError(`export: ${error.message}`);
    const page = packExportPageSchema.parse(data);
    rows.push(...page.items);
    if (page.levels) levels = page.levels;
    after = page.next;
  } while (after);

  const items = rows.map((row) => packItemFromExport(row, { noDerivatives }));
  const invalid: ExportSummary['invalid'] = [];
  const valid: ContentPackItem[] = [];
  for (const item of items) {
    const parsed = contentPackItemSchema.safeParse(item);
    if (parsed.success) valid.push(item);
    else {
      invalid.push({
        key: item.key,
        title: item.title,
        problems: parsed.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: /^[a-z][A-Za-z0-9]*$/.test(i.message) ? i.message : 'invalid',
        })),
      });
    }
  }
  const people = findPeople(valid, await boardPeople(ctx, boardId), allowed);
  const leftOut = new Set(people.map((f) => f.key));
  const kept = valid.filter((item) => !leftOut.has(item.key));
  if (!kept.length) {
    throw new CliError(
      `nothing to export: ${rows.length} approved resource(s) match, ` +
        `${people.length} name someone, ${invalid.length} cannot be carried by a pack.`,
    );
  }

  const pack = assemblePack({
    header: {
      slug,
      version,
      title,
      publisher,
      licence,
      noDerivatives,
      createdAt: new Date().toISOString(),
      contentSchemaVersion: 1,
    },
    levels,
    tags: packTagsFromExport(rows),
    items: kept,
  });
  const { errors } = validatePack(pack);
  if (errors.length) {
    // Every item was checked on its own: this is a bug, not the operator's problem to fix.
    throw new CliError(
      `the pack does not validate: ${errors
        .slice(0, 10)
        .map((e) => `${e.path} ${e.message}`)
        .join('; ')}`,
    );
  }
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text, { mode: 0o600 });
  const { error } = await ctx.db.rpc('content_pack_record_export', {
    p_board_id: boardId,
    p_slug: slug,
    p_version: version,
    p_item_count: pack.items.length,
    p_file_sha256: sha256,
  });
  if (error)
    throw new CliError(`the file is written, but the export was not audited: ${error.message}`);
  return exportText({
    board: board.name,
    out: ctx.values.out ?? out,
    pack,
    bytes: Buffer.byteLength(text),
    sha256,
    people,
    invalid,
    teacherItems,
  });
}

async function importPack(ctx: CliContext): Promise<string> {
  const boardSlug = need(ctx, 'board');
  const given = need(ctx, 'file');
  const levelMap = parseLevelMap(ctx.values['level-map']);
  const approve = Boolean(ctx.values.approve);
  const approverEmail = ctx.values.approver?.trim().toLowerCase();
  if (approve && !approverEmail) throw new CliError('--approve needs --approver <email>');
  if (!approve && approverEmail) throw new CliError('--approver goes with --approve');

  let bytes: Buffer;
  try {
    bytes = readFileSync(operatorPath(given));
  } catch {
    throw new CliError(`cannot read ${given}`);
  }
  const fileSha256 = createHash('sha256').update(bytes).digest('hex');
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new CliError(`${given} is not a JSON file`);
  }
  const { errors, warnings } = validatePack(json);
  if (errors.length) {
    const shown = errors
      .slice(0, 20)
      .map((e) => `  ${e.path || '(file)'}: ${e.message}`)
      .join('\n');
    throw new CliError(
      `${given} is not a valid content pack (${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing was staged):\n${shown}`,
    );
  }
  const pack = json as ContentPack;
  const { items, ...header } = pack;

  const board = await boardBySlug(ctx, boardSlug);
  const boardId = board.id;
  let approverId: string | null = null;
  if (approve) {
    const { data, error } = await ctx.db
      .from('users')
      .select('id')
      .eq('email', approverEmail!)
      .maybeSingle();
    if (error) throw new CliError(`approver: ${error.message}`);
    if (!data) throw new CliError(`approver ${approverEmail}: no such user`);
    approverId = data.id;
  }
  const faithKeys = items.filter((item) => packItemSuggestsFaith(item)).map((item) => item.key);

  const staged = await ctx.db.rpc('content_pack_stage', {
    p_board_id: boardId,
    p_header: header as unknown as Json,
    p_file_sha256: fileSha256,
  });
  if (staged.error) throw packError(staged.error, 'staging');
  const importId = staged.data;
  let applied = false;
  try {
    for (let i = 0; i < items.length; i += STAGE_CHUNK) {
      const chunk = items.slice(i, i + STAGE_CHUNK);
      const keys = new Set(chunk.map((item) => item.key));
      const { error } = await ctx.db.rpc('content_pack_stage_items', {
        p_import_id: importId,
        p_items: chunk as unknown as Json,
        p_faith_keys: faithKeys.filter((key) => keys.has(key)),
      });
      if (error) throw packError(error, 'staging');
    }
    const options = { levelMap, approve, approverId };
    const result = ctx.values.apply
      ? await ctx.db.rpc('content_pack_apply', { p_import_id: importId, p_options: options })
      : await ctx.db.rpc('content_pack_preview', { p_import_id: importId, p_options: options });
    if (result.error) throw packError(result.error, ctx.values.apply ? 'import' : 'dry run');
    applied = Boolean(ctx.values.apply);
    const report = importReportSchema.parse(result.data);
    const shownWarnings = warnings.length
      ? `\n\nFile warnings: ${warnings.map((w) => `${w.path} ${w.message}`).join('; ')}`
      : '';
    return importText(report, given) + shownWarnings;
  } finally {
    // A dry run, or a failed import, leaves nothing staged.
    if (!applied) await ctx.db.rpc('content_pack_discard', { p_import_id: importId });
  }
}

async function listPacks(ctx: CliContext): Promise<string> {
  const board = await boardBySlug(ctx, need(ctx, 'board'));
  const { data, error } = await ctx.db.rpc('content_pack_list', { p_board_id: board.id });
  if (error) throw new CliError(`packs: ${error.message}`);
  return listText(board.name, listSchema.parse(data));
}

export const packCommands: Record<string, Command> = {
  'export-pack': exportPack,
  'import-pack': importPack,
  'list-packs': listPacks,
};
