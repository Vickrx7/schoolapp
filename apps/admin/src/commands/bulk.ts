/**
 * Bulk generation of board drafts with the Message Batches API (DECISIONS D-095 to D-098): one
 * batch per run, a hard worst-case cost cap (`--max-cost`, never above BULK_MAX_RUN_USD),
 * deduplication before generation, and a report here. Run by the operator, one board at a time;
 * the drafts land in the reviewers' « Brouillons du conseil ».
 *
 *   pnpm admin bulk-plan --board csc-demo --grade 3 --subject mat --types worksheet,quiz --max-cost 25
 *     [--strand B] [--expectations B1.1,B1.2 | --from-coverage 2] [--levels all|none]
 *     [--per-expectation 1] [--sub-friendly] [--note "…"]
 *   pnpm admin bulk-start --run <id>
 *   pnpm admin bulk-status --run <id>
 *   pnpm admin bulk-cancel --run <id>
 *   pnpm admin bulk-report --run <id> [--csv]
 *
 * `bulk-plan` writes the run and its requests (one per attente and type: the specific attentes of
 * the grades and subject, and the overall ones without children), leaving out what the board
 * already has (`--per-expectation` items of that type linked to the attente: approved, shared
 * with the board, or the board's own drafts). It prints the worst case and the usual cost, and
 * how many requests fit under the cap. Running the same plan later retries only what is still
 * missing. `bulk-start` hands the run to the worker, which sends one batch sized to the cap,
 * reads it when it has ended (usually within the hour, at most 24 hours) and deletes it from the
 * provider. --levels defaults to all (the versions every board level needs for approval);
 * --grade takes one or two grades (3 or 3,5); --subject is a subject code.
 */
import {
  fallbackInputTokens,
  fitWithinCap,
  libraryItemFeature,
  loadPrompt,
  prepareCall,
  priceFor,
  schemaJsonText,
  totalUsd,
  UnknownModelPriceError,
  worstCaseUsd,
  type ModelPrice,
} from '@lynx/ai';
import { LIBRARY_ITEM_TYPES, TYPE_INFO, type LibraryItemType } from '@lynx/content';
import type { Json } from '@lynx/db';
import type { CliOption, CliValues } from '../args';
import {
  boardBySlug,
  check,
  CliError,
  csvCell,
  money,
  need,
  type CliContext,
  type Command,
} from '../context';

/** Real cost has been about a fifth of the worst case (D-096): the usual range printed. */
export const USUAL_SHARE = { low: 0.1, high: 0.3 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------
// Options (checked before the database is reached)
// ---------------------------------------------------------------------------------------

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** --types: 1 to 6 distinct resource types, never a Catholic reflection (D-095). */
export function parseTypes(value: string | undefined): LibraryItemType[] {
  const types = list(value);
  if (!types.length) throw new CliError('--types is required (e.g. worksheet,quiz)');
  if (types.length > 6) throw new CliError('--types takes at most 6 types');
  if (new Set(types).size !== types.length) throw new CliError('--types lists a type twice');
  for (const type of types) {
    if (!(LIBRARY_ITEM_TYPES as readonly string[]).includes(type)) {
      throw new CliError(`--types: unknown type "${type}"`);
    }
    if (type === 'catholic_reflection') {
      throw new CliError('--types: faith reflections are generated one at a time, not in bulk');
    }
  }
  return types as LibraryItemType[];
}

/** --grade: one or two grade codes (3, or 3,5; K1 and K2 for the kindergarten years). */
export function parseGrades(value: string | undefined): string[] {
  const grades = list(value).map((g) => g.toUpperCase());
  if (!grades.length) throw new CliError('--grade is required (e.g. 3, or 3,5)');
  if (grades.length > 2 || new Set(grades).size !== grades.length) {
    throw new CliError('--grade takes one or two different grades');
  }
  return grades;
}

/**
 * --max-cost: the run's hard cap in US dollars, above 0, at most 1,000 (the database's limit) and
 * at most BULK_MAX_RUN_USD (the worker refuses anything above it, D-096).
 */
export function parseMaxCost(value: string | undefined, maxRunUsd: number): number {
  if (value === undefined || value.trim() === '') {
    throw new CliError('--max-cost is required (US dollars, the most this run may cost)');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new CliError('--max-cost must be a positive amount');
  if (Math.round(n * 100) / 100 !== n) throw new CliError('--max-cost takes at most 2 decimals');
  if (n > Math.min(1000, maxRunUsd)) {
    throw new CliError(
      `--max-cost ${n} is above BULK_MAX_RUN_USD (${maxRunUsd}), the most one run may cost; the worker would refuse it`,
    );
  }
  return n;
}

function wholeNumber(value: string | undefined, key: CliOption, min: number, max: number) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CliError(`--${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

export interface PlanOptions {
  grades: string[];
  subjectCode: string;
  types: LibraryItemType[];
  maxCost: number;
  levels: 'all' | 'none';
  perExpectation: number;
  subFriendly: boolean;
  strandCodes: string[] | null;
  expectationCodes: string[] | null;
  fromCoverage: number | null;
  note: string | null;
}

/** Every bulk-plan option, checked. */
export function parsePlanOptions(values: CliValues, maxRunUsd: number): PlanOptions {
  const subjectCode = values.subject?.trim().toLowerCase();
  if (!subjectCode) throw new CliError('--subject is required (a subject code, e.g. mat)');
  const levels = values.levels?.trim() ?? 'all';
  if (levels !== 'all' && levels !== 'none') throw new CliError('--levels must be all or none');
  const expectationCodes = values.expectations === undefined ? null : list(values.expectations);
  const strandCodes = values.strand === undefined ? null : list(values.strand);
  const fromCoverage = wholeNumber(values['from-coverage'], 'from-coverage', 1, 5) ?? null;
  const filters = [expectationCodes, strandCodes, fromCoverage].filter((f) => f !== null);
  if (filters.length > 1) {
    throw new CliError('use one of --strand, --expectations and --from-coverage');
  }
  if (expectationCodes?.length === 0 || strandCodes?.length === 0) {
    throw new CliError('--strand and --expectations take codes (e.g. B1.1,B1.2)');
  }
  const note = values.note?.trim() || null;
  if (note && note.length > 1000) throw new CliError('--note takes at most 1,000 characters');
  const types = parseTypes(values.types);
  if (values['sub-friendly'] && types.every((t) => !TYPE_INFO[t].subFriendlyAllowed)) {
    throw new CliError('--sub-friendly: none of these types is ever used by a substitute');
  }
  return {
    grades: parseGrades(values.grade),
    subjectCode,
    types,
    maxCost: parseMaxCost(values['max-cost'], maxRunUsd),
    levels,
    perExpectation: wholeNumber(values['per-expectation'], 'per-expectation', 1, 3) ?? 1,
    subFriendly: values['sub-friendly'] === true,
    strandCodes,
    expectationCodes,
    fromCoverage,
    note,
  };
}

/** `public.library_bulk_plan`'s parameters: ids and codes, and each type's default duration. */
export function planParams(options: PlanOptions, subjectId: string): Record<string, unknown> {
  return {
    gradeCodes: options.grades,
    subjectId,
    types: options.types,
    levels: options.levels,
    perExpectation: options.perExpectation,
    subFriendly: options.subFriendly,
    durations: Object.fromEntries(
      options.types.map((t) => [t, Math.min(240, Math.max(5, TYPE_INFO[t].defaultDuration))]),
    ),
    ...(options.strandCodes ? { strandCodes: options.strandCodes } : {}),
    ...(options.expectationCodes ? { expectationCodes: options.expectationCodes } : {}),
    ...(options.fromCoverage ? { fromCoverage: { minApproved: options.fromCoverage } } : {}),
  };
}

export function parseRunId(value: string | undefined): string {
  const id = value?.trim() ?? '';
  if (!UUID.test(id)) throw new CliError('--run must be a run id (as bulk-plan printed it)');
  return id.toLowerCase();
}

// ---------------------------------------------------------------------------------------
// The estimate (D-096): the worker sizes the batch with exact token counts; this is an upper
// bound from the bytes of each request, with the same arithmetic.
// ---------------------------------------------------------------------------------------

export interface RunEstimate {
  /** Requests to send, in the worker's order. */
  requests: number;
  /** Requests the worker will refuse before sending (a personal detail, an input it rejects). */
  refused: number;
  worstCaseUsd: number;
  fit: number;
  over: number;
  fitWorstCaseUsd: number;
  usualLowUsd: number;
  usualHighUsd: number;
}

export function estimateRun(worstCases: readonly (number | null)[], capUsd: number): RunEstimate {
  const sendable = worstCases
    .filter((w): w is number => w !== null)
    .map((worstCaseUsd) => ({ worstCaseUsd }));
  const { fit, rest } = fitWithinCap(sendable, capUsd);
  const fitWorst = totalUsd(fit);
  return {
    requests: worstCases.length,
    refused: worstCases.length - sendable.length,
    worstCaseUsd: totalUsd(sendable),
    fit: fit.length,
    over: rest.length,
    fitWorstCaseUsd: fitWorst,
    usualLowUsd: fitWorst * USUAL_SHARE.low,
    usualHighUsd: fitWorst * USUAL_SHARE.high,
  };
}

/** The price the worker will pay (its AI settings, as the worker reads them). */
export function runPrice(env: {
  AI_PROVIDER: string;
  AI_MODEL: string;
  AI_PRICE_INPUT_PER_MTOK?: number | undefined;
  AI_PRICE_OUTPUT_PER_MTOK?: number | undefined;
}): ModelPrice {
  if (env.AI_PROVIDER === 'fake') return priceFor('fake');
  try {
    return priceFor(env.AI_MODEL, {
      ...(env.AI_PRICE_INPUT_PER_MTOK !== undefined ? { input: env.AI_PRICE_INPUT_PER_MTOK } : {}),
      ...(env.AI_PRICE_OUTPUT_PER_MTOK !== undefined
        ? { output: env.AI_PRICE_OUTPUT_PER_MTOK }
        : {}),
    });
  } catch (error) {
    if (error instanceof UnknownModelPriceError) throw new CliError(error.message);
    throw error;
  }
}

/** Each request's worst case (null when the worker will refuse it before sending). */
export async function requestWorstCases(
  inputs: readonly unknown[],
  price: ModelPrice,
): Promise<(number | null)[]> {
  const systemPrompt = await loadPrompt(libraryItemFeature.name, libraryItemFeature.promptVersion);
  return inputs.map((input) => {
    // The board's people are not needed for the size; the worker checks them before sending.
    const prepared = prepareCall(libraryItemFeature, input, { systemPrompt, people: [] });
    if (!prepared.ok) return null;
    const tokens = fallbackInputTokens(
      prepared.system,
      prepared.user,
      schemaJsonText(prepared.schema),
    );
    return worstCaseUsd(tokens, prepared.maxTokens, price);
  });
}

export interface PlanResult {
  runId: string;
  planned: number;
  skipped: { covered: number };
  byType: Record<string, { planned: number; covered: number }>;
}

/** What bulk-plan prints. */
export function planSummary(
  meta: {
    board: string;
    grades: string[];
    subject: string;
    types: readonly string[];
    levels: string;
    maxCost: number;
  },
  plan: PlanResult,
  estimate: RunEstimate,
): string {
  const byType = meta.types
    .map((t) => {
      const n = plan.byType[t] ?? { planned: 0, covered: 0 };
      return `${t} ${n.planned}${n.covered ? ` (${n.covered} covered)` : ''}`;
    })
    .join(' · ');
  const out = [
    `Planned run ${plan.runId} for ${meta.board}: ${meta.grades.join(', ')}, ${meta.subject}; ${meta.types.join(', ')} (levels: ${meta.levels}).`,
    `  ${plan.planned} requests · ${plan.skipped.covered} already covered · worst case ${money(estimate.worstCaseUsd)} · ` +
      `usually ${money(estimate.usualLowUsd)}–${money(estimate.usualHighUsd)} · cap ${money(meta.maxCost)}`,
    `  ${estimate.fit} requests fit under the cap by this estimate` +
      (estimate.over ? `; ${estimate.over} exceed it and will be skipped` : '') +
      ' (the worker counts tokens exactly, so it may send a few more).',
  ];
  if (estimate.refused) {
    out.push(
      `  ${estimate.refused} requests will be refused before sending: a personal detail (an e-mail address, a phone number…) in the note or in an existing title.`,
    );
  }
  out.push(`  By type: ${byType}`, `Start it with: pnpm admin bulk-start --run ${plan.runId}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// Reading runs
// ---------------------------------------------------------------------------------------

/** What each failure code means, for the operator. */
export const FAILURE_HELP: Record<string, string> = {
  aiUnavailable: 'AI is off on the worker (AI_PROVIDER)',
  aiDisabled: 'the board does not allow AI (set-ai-board --allowed)',
  overLimit: 'the cap is above the worker’s BULK_MAX_RUN_USD',
  submitFailed: 'the provider refused the batch; nothing was generated',
  submitUnconfirmed:
    'the worker stopped while sending: check the Anthropic console for a batch created then (cancel it there); it is never sent again',
  personalInfo: 'a personal detail in the request (note or existing title)',
  invalidInput: 'the request no longer matches the feature’s input',
  invalidOutput: 'the answer did not pass the checks',
  aiRefused: 'the model declined',
  aiTooLong: 'the answer was cut off at max_tokens',
  redaction_changed: 'the board’s people changed between sending and reading',
  batch_invalid_request: 'the API refused the request',
  batch_server_error: 'the API failed on this request',
  batch_expired: 'the batch expired (24 hours) before this request was processed',
  batch_canceled: 'cancelled before it was processed',
  batch_missing: 'no answer in the batch',
};

async function loadRun(ctx: CliContext, runId: string) {
  return check(
    await ctx.db
      .from('library_bulk_runs')
      .select(
        'id, board_id, status, params, note, max_cost_usd, worst_case_usd, spent_usd, request_count, batch_id, submit_started_at, cancel_requested_at, cancel_sent_at, report, error_code, created_at, started_at, finished_at, boards(name)',
      )
      .eq('id', runId)
      .maybeSingle(),
    `run ${runId}`,
  );
}

type RunRow = Awaited<ReturnType<typeof loadRun>>;

async function loadRequests(ctx: CliContext, runId: string) {
  const rows: {
    id: string;
    item_type: string;
    status: string;
    reason: string | null;
    problems: string[];
    worst_case_usd: number | null;
    cost_usd: number;
    item_id: string | null;
    curriculum_expectations: { code: string; grade_code: string } | null;
    library_items: { title: string; status: string } | null;
  }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ctx.db
      .from('library_bulk_requests')
      .select(
        'id, item_type, status, reason, problems, worst_case_usd, cost_usd, item_id, curriculum_expectations(code, grade_code), library_items(title, status)',
      )
      .eq('run_id', runId)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new CliError(`requests: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  // In curriculum order (grade, then attente code), then type.
  const grade = (code: string | undefined) =>
    code === 'K1' ? -1 : code === 'K2' ? 0 : Number(code);
  return rows.sort(
    (a, b) =>
      grade(a.curriculum_expectations?.grade_code) - grade(b.curriculum_expectations?.grade_code) ||
      (a.curriculum_expectations?.code ?? '').localeCompare(
        b.curriculum_expectations?.code ?? '',
        'fr',
        {
          numeric: true,
        },
      ) ||
      a.item_type.localeCompare(b.item_type),
  );
}

const when = (iso: string | null) =>
  iso ? `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';

/** Requests by status (and reason), as « 37 submitted · 11 skipped (cost_cap) ». */
export function requestCounts(rows: readonly { status: string; reason: string | null }[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key =
      r.status === 'skipped' || r.status === 'failed'
        ? `${r.status} (${r.reason ?? '?'})`
        : r.status;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(' · ') || 'none';
}

function statusText(run: RunRow, rows: Awaited<ReturnType<typeof loadRequests>>): string {
  const board = (run.boards as { name: string } | null)?.name ?? run.board_id;
  const out = [
    `Run ${run.id} (${board}): ${run.status}` +
      (run.status === 'planned'
        ? `, planned ${when(run.created_at)}`
        : run.finished_at
          ? `, ended ${when(run.finished_at)}`
          : `, since ${when(run.started_at)}`),
    `  Requests: ${requestCounts(rows)}`,
    `  Cap ${money(Number(run.max_cost_usd))} · worst case sent ${money(Number(run.worst_case_usd ?? 0))} · spent ${money(Number(run.spent_usd))}` +
      (run.batch_id ? ` · batch ${run.batch_id}` : ''),
  ];
  if (run.cancel_requested_at && run.status === 'running') {
    out.push(`  Cancellation asked ${when(run.cancel_requested_at)}.`);
  }
  if (
    run.status === 'running' &&
    run.submit_started_at &&
    !run.batch_id &&
    Date.now() - new Date(run.submit_started_at).getTime() > 15 * 60_000
  ) {
    out.push(
      `  Submission began ${when(run.submit_started_at)} and was never confirmed: check the Anthropic console for a batch created then, and cancel it there. The daily clean-up fails this run (submitUnconfirmed); it is never sent again.`,
    );
  } else if (run.status === 'running' && run.batch_id) {
    out.push(
      '  The worker reads the batch when it has ended (usually within the hour, at most 24 hours).',
    );
  } else if (run.status === 'running') {
    out.push('  The worker sends the batch at its next step (within 5 minutes).');
  }
  if (run.error_code) {
    out.push(
      `  Failed: ${run.error_code}${FAILURE_HELP[run.error_code] ? ` (${FAILURE_HELP[run.error_code]})` : ''}.`,
    );
  }
  if (run.status === 'completed' || run.status === 'cancelled') {
    out.push(`  Report: pnpm admin bulk-report --run ${run.id}`);
  }
  return out.join('\n');
}

interface Report {
  requests?: number;
  created?: number;
  similarTitles?: number;
  skipped?: { covered?: number; costCap?: number; cancelled?: number };
  failed?: Record<string, number>;
  spentUsd?: number;
  worstCaseUsd?: number;
  maxCostUsd?: number;
}

export const REPORT_CSV_HEADER = [
  'run_id',
  'grade',
  'expectation_code',
  'item_type',
  'status',
  'reason',
  'problems',
  'worst_case_usd',
  'cost_usd',
  'item_id',
  'item_status',
  'item_title',
] as const;

export function reportCsv(runId: string, rows: Awaited<ReturnType<typeof loadRequests>>): string {
  return [
    REPORT_CSV_HEADER.join(','),
    ...rows.map((r) =>
      [
        runId,
        r.curriculum_expectations?.grade_code ?? '',
        r.curriculum_expectations?.code ?? '',
        r.item_type,
        r.status,
        r.reason ?? '',
        r.problems.join(';'),
        r.worst_case_usd === null ? '' : Number(r.worst_case_usd).toFixed(6),
        Number(r.cost_usd).toFixed(6),
        r.item_id ?? '',
        r.library_items?.status ?? '',
        r.library_items?.title ?? '',
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');
}

export function reportText(
  run: { id: string; status: string; report: Report | null },
  board: string,
  rows: Awaited<ReturnType<typeof loadRequests>>,
): string {
  const r = run.report ?? {};
  const failed = Object.entries(r.failed ?? {})
    .map(([code, n]) => `${n} ${code}`)
    .join(', ');
  const out = [
    `Run ${run.id} (${board}): ${run.status}`,
    `  ${r.created ?? 0} created · ${r.similarTitles ?? 0} similar titles · skipped: ${r.skipped?.covered ?? 0} covered, ` +
      `${r.skipped?.costCap ?? 0} over the cap, ${r.skipped?.cancelled ?? 0} cancelled · failed: ${failed || 'none'}`,
    `  Spent ${money(Number(r.spentUsd ?? 0))} of a worst case of ${money(Number(r.worstCaseUsd ?? 0))} (cap ${money(Number(r.maxCostUsd ?? 0))})`,
  ];
  if (!run.report) out.push('  The run has not ended: this is what it holds so far.');
  for (const row of rows) {
    const code = row.curriculum_expectations?.code ?? '?';
    const detail =
      row.status === 'created'
        ? `« ${row.library_items?.title ?? '(deleted)'} »${row.library_items ? ` (${row.library_items.status})` : ''}`
        : row.reason
          ? `${row.reason}${FAILURE_HELP[row.reason] ? `: ${FAILURE_HELP[row.reason]}` : ''}`
          : '';
    const problems = row.problems.length ? ` [${row.problems.join(', ')}]` : '';
    out.push(
      `  ${code.padEnd(8)} ${row.item_type.padEnd(18)} ${row.status.padEnd(9)} ${detail}${problems}`,
    );
  }
  if (Object.keys(r.failed ?? {}).length) {
    out.push('Running the same bulk-plan again plans only what is still missing.');
  }
  return out.join('\n');
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

/** The database's refusals, in words. */
function planError(error: { code?: string; message: string; details?: string | null }): CliError {
  switch (error.code) {
    case 'LXA01':
      return new CliError('the board does not allow AI (pnpm admin set-ai-board --allowed true)');
    case 'LXB01':
      return new CliError('the run is not in a state that allows this');
    case 'LXB02':
      return new CliError(
        `too many requests for one run (${error.details ?? 'over 500'}, at most 500): narrow it with --strand, --expectations or fewer types`,
      );
    case 'LXB03':
      return new CliError(
        'the board already has a planned or running run: finish, cancel (bulk-cancel) or wait for it first',
      );
    case '23514':
      return new CliError('--max-cost must be above 0 and at most 1000');
    case '22023':
      if (error.details === 'no_targets') return new CliError('no attente matches these options');
      if (error.message === 'unknown attente') {
        return new CliError(
          `unknown attente code "${error.details ?? ''}" for these grades and subject`,
        );
      }
      if (error.message === 'invalid subject') {
        return new CliError(
          'this subject cannot be generated in bulk (inactive, or Enseignement religieux)',
        );
      }
      return new CliError(`the plan was refused: ${error.message}`);
    default:
      return new CliError(`plan: ${error.message}`);
  }
}

export const bulkCommands: Record<string, Command> = {
  async 'bulk-plan'(ctx) {
    // Every option is checked before the database is reached.
    const slug = need(ctx, 'board');
    const options = parsePlanOptions(ctx.values, ctx.env.BULK_MAX_RUN_USD);
    const price = runPrice(ctx.env);
    const board = await boardBySlug(ctx, slug);
    const subject = await subjectByCode(ctx, board.id, options.subjectCode);
    const { data: grades } = await ctx.db
      .from('grades')
      .select('code, label_fr, ordinal')
      .in('code', options.grades)
      .order('ordinal');
    if ((grades ?? []).length !== options.grades.length) {
      throw new CliError(`--grade: unknown grade (${options.grades.join(', ')})`);
    }
    const { data, error } = await ctx.db.rpc('library_bulk_plan', {
      p_board_id: board.id,
      p_params: planParams(options, subject.id) as Json,
      p_max_cost_usd: options.maxCost,
      // A blank note is stored as none.
      p_note: options.note ?? '',
    });
    if (error) throw planError(error);
    const plan = data as unknown as PlanResult;
    if (plan.planned === 0) {
      const cancel = await ctx.db.rpc('library_bulk_cancel', { p_run_id: plan.runId });
      if (cancel.error) throw new CliError(`cancel: ${cancel.error.message}`);
      return `Nothing to generate for ${board.name}: every attente already has what you asked for (${plan.skipped.covered} covered). The run was cancelled.`;
    }
    const { data: inputs, error: inputError } = await ctx.db
      .from('library_bulk_requests')
      .select('input')
      .eq('run_id', plan.runId)
      .eq('status', 'planned')
      .order('id');
    if (inputError) throw new CliError(`requests: ${inputError.message}`);
    const estimate = estimateRun(
      await requestWorstCases(
        (inputs ?? []).map((r) => r.input),
        price,
      ),
      options.maxCost,
    );
    const warning =
      ctx.env.AI_PROVIDER === 'none'
        ? '\nWarning: AI_PROVIDER is none here; the worker must run with AI on, or the run fails (aiUnavailable).'
        : '';
    return (
      planSummary(
        {
          board: board.name,
          grades: (grades ?? []).map((g) => g.label_fr),
          subject: subject.label_fr,
          types: options.types,
          levels: options.levels,
          maxCost: options.maxCost,
        },
        plan,
        estimate,
      ) + warning
    );
  },

  async 'bulk-start'(ctx) {
    const runId = parseRunId(ctx.values.run);
    const run = await loadRun(ctx, runId);
    if (Number(run.max_cost_usd) > ctx.env.BULK_MAX_RUN_USD) {
      throw new CliError(
        `the run's cap (${money(Number(run.max_cost_usd))}) is above BULK_MAX_RUN_USD (${ctx.env.BULK_MAX_RUN_USD}): the worker would refuse it`,
      );
    }
    const { error } = await ctx.db.rpc('library_bulk_start', { p_run_id: runId });
    if (error) {
      if (error.code === 'LXB01') throw new CliError(`the run is ${run.status}, not planned`);
      throw planError(error);
    }
    return [
      `Run ${runId} started: ${run.request_count} requests, cap ${money(Number(run.max_cost_usd))}.`,
      'The worker sends one batch at its next step (at once when it is running), then reads it when it has ended (usually within the hour, at most 24 hours).',
      `Follow it with: pnpm admin bulk-status --run ${runId}`,
    ].join('\n');
  },

  async 'bulk-status'(ctx) {
    const runId = parseRunId(ctx.values.run);
    const run = await loadRun(ctx, runId);
    return statusText(run, await loadRequests(ctx, runId));
  },

  async 'bulk-cancel'(ctx) {
    const runId = parseRunId(ctx.values.run);
    const before = await loadRun(ctx, runId);
    const { error } = await ctx.db.rpc('library_bulk_cancel', { p_run_id: runId });
    if (error) {
      if (error.code === 'LXB01')
        throw new CliError(`the run has already ended (${before.status})`);
      throw planError(error);
    }
    return before.status === 'planned'
      ? `Run ${runId} cancelled.`
      : before.batch_id
        ? `Cancellation asked: the worker cancels the batch at its next step. Answers already made are still recorded (and billed).`
        : `Cancellation asked: the worker cancels the run at its next step, before sending anything.`;
  },

  async 'bulk-report'(ctx) {
    const runId = parseRunId(ctx.values.run);
    const run = await loadRun(ctx, runId);
    const rows = await loadRequests(ctx, runId);
    if (ctx.values.csv) return reportCsv(runId, rows);
    const board = (run.boards as { name: string } | null)?.name ?? run.board_id;
    return reportText(
      { id: run.id, status: run.status, report: run.report as Report | null },
      board,
      rows,
    );
  },
};
