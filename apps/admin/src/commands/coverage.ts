/**
 * « Couverture du curriculum » for the operator (DECISIONS D-094; slice S5): the attentes of a
 * grade and subject with no or few board-approved resources, from the same database function as
 * the app's page (`public.library_coverage`, which the service role may call), or, without a
 * grade and subject, the summary of every grade and subject (`public.library_coverage_summary`).
 * « In review » (requested items and the board's drafts) is always shown to the operator.
 *
 *   pnpm admin coverage --board csc-demo --grade 3 --subject mat [--min 2] [--csv]
 *   pnpm admin coverage --board csc-demo [--min 2] [--csv]
 *
 * --subject is a subject code (the board's own subject first, else the standard one); --min is the
 * threshold under which an attente has « few » resources (1 to 5, default 2).
 */
import {
  boardBySlug,
  check,
  CliError,
  csvCell,
  need,
  type CliContext,
  type Command,
} from '../context';

export const COVERAGE_MIN_DEFAULT = 2;

export type CoverageLevel = 'none' | 'few' | 'covered';

/** The level of an attente with `approved` approved resources, for a threshold (as the app). */
export function coverageLevel(approved: number, min: number): CoverageLevel {
  if (approved <= 0) return 'none';
  return approved < min ? 'few' : 'covered';
}

/** --min: a whole number from 1 to 5, 2 when left out. */
export function parseMin(value: string | undefined): number {
  if (value === undefined) return COVERAGE_MIN_DEFAULT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5)
    throw new CliError('--min must be a whole number from 1 to 5');
  return n;
}

/** A row of `public.library_coverage`. */
export interface CoverageLine {
  expectationId: string;
  parentId: string | null;
  strandId: string | null;
  kind: 'overall' | 'specific';
  code: string;
  text: string;
  verified: boolean;
  sortOrder: number;
  hasChildren: boolean;
  approved: number;
  inReview: number | null;
  types: string[];
}

export interface StrandInfo {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
}

export interface OrderedLine {
  line: CoverageLine;
  /** 1 for a specific attente listed under its overall attente. */
  depth: 0 | 1;
  /** Counted in the totals: a specific attente, or an overall attente without children. */
  unit: boolean;
}

export interface CoverageGroup {
  /** Null for attentes without a known domaine (listed last). */
  strand: StrandInfo | null;
  lines: OrderedLine[];
}

const byOrder = (a: { sortOrder: number; code: string }, b: { sortOrder: number; code: string }) =>
  a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'fr', { numeric: true });

/**
 * By domaine (in their order, then attentes without one), each overall attente followed by its
 * specific attentes, in curriculum order, as on the app's page.
 */
export function orderCoverage(
  lines: readonly CoverageLine[],
  strands: readonly StrandInfo[],
): CoverageGroup[] {
  const sorted = [...lines].sort(byOrder);
  const byId = new Map(sorted.map((l) => [l.expectationId, l]));
  const nested = (l: CoverageLine) =>
    l.kind === 'specific' && l.parentId !== null && byId.get(l.parentId)?.kind === 'overall';
  const strandById = new Map(strands.map((s) => [s.id, s]));
  const groups = new Map<string | null, CoverageGroup>();
  for (const top of sorted.filter((l) => !nested(l))) {
    const strand = (top.strandId && strandById.get(top.strandId)) || null;
    let group = groups.get(strand?.id ?? null);
    if (!group) {
      group = { strand, lines: [] };
      groups.set(strand?.id ?? null, group);
    }
    group.lines.push({ line: top, depth: 0, unit: top.kind === 'specific' || !top.hasChildren });
    for (const child of sorted.filter((l) => nested(l) && l.parentId === top.expectationId)) {
      group.lines.push({ line: child, depth: 1, unit: true });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.strand || !b.strand) return a.strand ? -1 : b.strand ? 1 : 0;
    return byOrder(a.strand, b.strand);
  });
}

interface Counts {
  units: number;
  none: number;
  few: number;
  covered: number;
}

function countUnits(lines: readonly OrderedLine[], min: number): Counts {
  const counts: Counts = { units: 0, none: 0, few: 0, covered: 0 };
  for (const l of lines) {
    if (!l.unit) continue;
    counts.units++;
    counts[coverageLevel(l.line.approved, min)]++;
  }
  return counts;
}

/** One line of text: whitespace (line breaks included) collapsed, cut at `max` characters. */
function oneLine(text: string, max = Infinity): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface CoverageMeta {
  board: string;
  grade: string;
  subject: string;
  min: number;
}

/** The report the operator reads: the totals, then each domaine and its attentes. */
export function coverageText(meta: CoverageMeta, groups: readonly CoverageGroup[]): string {
  const all = countUnits(
    groups.flatMap((g) => g.lines),
    meta.min,
  );
  const out = [
    `Curriculum coverage: ${meta.board}, ${meta.grade}, ${meta.subject} (threshold ${meta.min})`,
  ];
  if (all.units === 0) {
    out.push('No expectations are loaded for this grade and subject.');
    return out.join('\n');
  }
  out.push(
    `${all.few + all.covered} of ${all.units} expectations have at least one approved resource: ` +
      `${all.none} with none, ${all.few} with fewer than ${meta.min}, ${all.covered} with ${meta.min} or more.`,
    'Counted: the board’s approved resources linked directly to each expectation (for an overall ' +
      'expectation, also those of its specific expectations, each once).',
  );
  for (const group of groups) {
    const counts = countUnits(group.lines, meta.min);
    out.push(
      '',
      `${group.strand ? `${group.strand.code} · ${group.strand.label}` : 'Other expectations'}: ` +
        `${counts.few + counts.covered} of ${counts.units}`,
    );
    for (const { line, depth, unit } of group.lines) {
      const status = unit ? coverageLevel(line.approved, meta.min) : 'overall';
      const details = [
        unit
          ? `${line.approved} approved`
          : `${line.approved} approved with its specific expectations`,
        line.inReview ? `${line.inReview} in review` : null,
        line.types.length ? line.types.join(', ') : null,
        line.verified ? null : 'to verify',
      ].filter(Boolean);
      out.push(
        `${'  '.repeat(depth + 1)}${line.code.padEnd(8 - depth * 2)} ${status.padEnd(8)} ` +
          `${details.join(' · ')} | ${oneLine(line.text, 90)}`,
      );
    }
  }
  return out.join('\n');
}

export const COVERAGE_CSV_HEADER = [
  'grade',
  'subject',
  'strand',
  'code',
  'kind',
  'parent_code',
  'unit',
  'level',
  'approved',
  'in_review',
  'approved_types',
  'verified',
  'text',
] as const;

/** Every attente as a CSV row (RFC 4180 quoting), in the report's order. */
export function coverageCsv(meta: CoverageMeta, groups: readonly CoverageGroup[]): string {
  const codes = new Map(groups.flatMap((g) => g.lines).map((l) => [l.line.expectationId, l.line]));
  return [
    COVERAGE_CSV_HEADER.join(','),
    ...groups.flatMap((group) =>
      group.lines.map(({ line, unit }) =>
        [
          meta.grade,
          meta.subject,
          group.strand?.code ?? '',
          line.code,
          line.kind,
          (line.parentId && codes.get(line.parentId)?.code) || '',
          unit,
          unit ? coverageLevel(line.approved, meta.min) : '',
          line.approved,
          line.inReview ?? '',
          line.types.join(';'),
          line.verified,
          oneLine(line.text),
        ]
          .map(csvCell)
          .join(','),
      ),
    ),
  ].join('\n');
}

/** A row of `public.library_coverage_summary`, with its labels. */
export interface SummaryLine {
  grade: string;
  subject: string;
  units: number;
  none: number;
  few: number;
  covered: number;
}

export function summaryText(board: string, min: number, lines: readonly SummaryLine[]): string {
  const out = [`Curriculum coverage: ${board}, every grade and subject (threshold ${min})`];
  if (!lines.length) out.push('No expectations are loaded for this board.');
  const gradeWidth = Math.max(0, ...lines.map((l) => l.grade.length));
  const subjectWidth = Math.max(0, ...lines.map((l) => l.subject.length));
  for (const l of lines) {
    out.push(
      `  ${l.grade.padEnd(gradeWidth)}  ${l.subject.padEnd(subjectWidth)}  ` +
        `${l.few + l.covered} of ${l.units} with at least one approved resource ` +
        `(${l.none} with none, ${l.few} with fewer than ${min}, ${l.covered} with ${min} or more)`,
    );
  }
  return out.join('\n');
}

export function summaryCsv(min: number, lines: readonly SummaryLine[]): string {
  return [
    'grade,subject,units,none,few,covered,with_any,threshold',
    ...lines.map((l) =>
      [l.grade, l.subject, l.units, l.none, l.few, l.covered, l.few + l.covered, min]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');
}

/** The board's own subject with that code, else the standard one. */
async function subjectByCode(ctx: CliContext, boardId: string, code: string) {
  const { data, error } = await ctx.db
    .from('subjects')
    .select('id, code, label_fr, board_id')
    .eq('code', code)
    .or(`board_id.is.null,board_id.eq.${boardId}`);
  if (error) throw new CliError(`subject "${code}": ${error.message}`);
  const subject = (data ?? []).find((s) => s.board_id === boardId) ?? data?.[0];
  if (!subject) throw new CliError(`subject "${code}": not found`);
  return subject;
}

async function report(ctx: CliContext, board: { id: string; name: string }, min: number) {
  const gradeCode = need(ctx, 'grade').toUpperCase();
  const grade = check(
    await ctx.db.from('grades').select('code, label_fr').eq('code', gradeCode).maybeSingle(),
    `grade "${gradeCode}"`,
  );
  const subject = await subjectByCode(ctx, board.id, need(ctx, 'subject').toLowerCase());
  const [strands, coverage] = await Promise.all([
    ctx.db.from('strands').select('id, code, label_fr, sort_order').eq('subject_id', subject.id),
    ctx.db.rpc('library_coverage', {
      p_board_id: board.id,
      p_grade_code: grade.code,
      p_subject_id: subject.id,
    }),
  ]);
  if (strands.error) throw new CliError(`strands: ${strands.error.message}`);
  if (coverage.error) throw new CliError(`coverage: ${coverage.error.message}`);
  const lines: CoverageLine[] = (coverage.data ?? []).map((raw) => {
    // Null where the curriculum has none (the generated types cannot know).
    const r = raw as { [K in keyof typeof raw]: (typeof raw)[K] | null };
    return {
      expectationId: raw.expectation_id,
      parentId: r.parent_id,
      strandId: r.strand_id,
      kind: raw.kind,
      code: raw.code,
      text: raw.text_fr,
      verified: raw.is_verified,
      sortOrder: raw.sort_order,
      hasChildren: raw.has_children,
      approved: raw.approved_count,
      inReview: r.in_review_count,
      types: raw.approved_types ?? [],
    };
  });
  const groups = orderCoverage(
    lines,
    (strands.data ?? []).map((s) => ({
      id: s.id,
      code: s.code,
      label: s.label_fr,
      sortOrder: s.sort_order,
    })),
  );
  const meta = { board: board.name, grade: grade.label_fr, subject: subject.label_fr, min };
  return ctx.values.csv ? coverageCsv(meta, groups) : coverageText(meta, groups);
}

async function summary(ctx: CliContext, board: { id: string; name: string }, min: number) {
  const [rows, grades, subjects] = await Promise.all([
    ctx.db.rpc('library_coverage_summary', { p_board_id: board.id, p_min_approved: min }),
    ctx.db.from('grades').select('code, label_fr'),
    ctx.db.from('subjects').select('id, label_fr').or(`board_id.is.null,board_id.eq.${board.id}`),
  ]);
  if (rows.error) throw new CliError(`coverage summary: ${rows.error.message}`);
  const gradeLabel = new Map((grades.data ?? []).map((g) => [g.code, g.label_fr]));
  const subjectLabel = new Map((subjects.data ?? []).map((s) => [s.id, s.label_fr]));
  const lines: SummaryLine[] = (rows.data ?? []).map((r) => ({
    grade: gradeLabel.get(r.grade_code) ?? r.grade_code,
    subject: subjectLabel.get(r.subject_id) ?? r.subject_id,
    units: r.unit_count,
    none: r.none_count,
    few: r.few_count,
    covered: r.covered_count,
  }));
  return ctx.values.csv ? summaryCsv(min, lines) : summaryText(board.name, min, lines);
}

export const coverageCommands: Record<string, Command> = {
  async coverage(ctx) {
    // Every option is checked before the database is reached.
    const slug = need(ctx, 'board');
    const min = parseMin(ctx.values.min);
    const hasGrade = Boolean(ctx.values.grade?.trim());
    const hasSubject = Boolean(ctx.values.subject?.trim());
    if (hasGrade !== hasSubject)
      throw new CliError('--grade and --subject go together (leave both out for the summary)');
    const board = await boardBySlug(ctx, slug);
    return hasGrade ? report(ctx, board, min) : summary(ctx, board, min);
  },
};
