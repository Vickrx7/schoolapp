/**
 * AI budgets and usage (US dollars of provider cost per month; DECISIONS D-040).
 */
import type { Json } from '@lynx/db';
import {
  amount,
  bool,
  boardBySlug,
  check,
  CliError,
  csvCell,
  money,
  need,
  schoolByPath,
  type Command,
} from '../context';

/** The calendar month (YYYY-MM) a timestamp falls in, in a school's time zone. */
function monthIn(timeZone: string, iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

export const aiCommands: Record<string, Command> = {
  async 'set-ai-budget'(ctx) {
    const { school } = await schoolByPath(ctx, need(ctx, 'school'));
    const allowance = amount(ctx, 'allowance');
    if (allowance === undefined) throw new CliError('--allowance is required');
    const ceiling = amount(ctx, 'ceiling');
    if (ceiling !== undefined && ceiling < allowance)
      throw new CliError('--ceiling must be at least the allowance');
    check(
      await ctx.db
        .from('ai_budgets')
        .upsert(
          {
            school_id: school.id,
            monthly_allowance_usd: allowance,
            monthly_ceiling_usd: ceiling ?? null,
            plan: ctx.values.plan?.trim() || null,
          },
          { onConflict: 'school_id' },
        )
        .select('school_id')
        .single(),
      'set AI budget',
    );
    return `${school.name}: ${money(allowance)} per month${ceiling !== undefined ? `, up to ${money(ceiling)} with the board pool` : ''}.`;
  },

  async 'set-ai-board'(ctx) {
    const slug = need(ctx, 'board');
    const board = check(
      await ctx.db.from('boards').select('id, name, settings').eq('slug', slug).maybeSingle(),
      `board "${slug}"`,
    );
    const settings = (board.settings ?? {}) as Record<string, unknown>;
    const ai = { ...((settings.ai as Record<string, unknown> | undefined) ?? {}) };
    const allowed = bool(ctx, 'allowed');
    const pooling = bool(ctx, 'pooling');
    const defaultAllowance = amount(ctx, 'default-allowance');
    const multiplier = amount(ctx, 'ceiling-multiplier');
    if (allowed !== undefined) ai.allowed = allowed;
    if (pooling !== undefined) ai.pooling = pooling;
    // Same bounds as the app (packages/domain settings.ts) and the database's guard trigger.
    if (defaultAllowance !== undefined) {
      if (defaultAllowance > 100_000)
        throw new CliError('--default-allowance must be at most 100000');
      ai.defaultMonthlyAllowanceUsd = defaultAllowance;
    }
    if (multiplier !== undefined) {
      if (multiplier < 1 || multiplier > 10)
        throw new CliError('--ceiling-multiplier must be between 1 and 10');
      ai.ceilingMultiplier = multiplier;
    }
    check(
      await ctx.db
        .from('boards')
        .update({ settings: { ...settings, ai } as Json })
        .eq('id', board.id)
        .select('id')
        .single(),
      'update board',
    );
    return `${board.name} AI settings: ${JSON.stringify(ai)}`;
  },

  async 'ai-usage'(ctx) {
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    const month = ctx.values.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new CliError('--month must look like 2026-10');
    const { data: schools } = await ctx.db
      .from('schools')
      .select('id, name, timezone, ai_enabled')
      .eq('board_id', board.id)
      .order('name');
    // A day of margin on each side; each row is then placed in its school's own month.
    const start = new Date(`${month}-01T00:00:00Z`);
    const from = new Date(start.getTime() - 86_400_000).toISOString();
    const to = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 2)).toISOString();
    const rows: {
      school_id: string | null;
      created_at: string;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await ctx.db
        .from('ai_generations')
        .select('school_id, created_at, input_tokens, output_tokens, estimated_cost_usd')
        .eq('board_id', board.id)
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at')
        .range(offset, offset + 999);
      if (error) throw new CliError(`usage: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const lines = (schools ?? []).map((s) => {
      const mine = rows.filter(
        (r) => r.school_id === s.id && monthIn(s.timezone, r.created_at) === month,
      );
      return {
        school: s.name,
        aiEnabled: s.ai_enabled,
        requests: mine.length,
        inputTokens: mine.reduce((n, r) => n + r.input_tokens, 0),
        outputTokens: mine.reduce((n, r) => n + r.output_tokens, 0),
        costUsd: mine.reduce((n, r) => n + Number(r.estimated_cost_usd), 0),
      };
    });
    const total = lines.reduce((n, l) => n + l.costUsd, 0);
    if (ctx.values.csv) {
      return [
        'month,board,school,ai_enabled,requests,input_tokens,output_tokens,cost_usd',
        ...lines.map((l) =>
          [
            month,
            board.name,
            l.school,
            l.aiEnabled,
            l.requests,
            l.inputTokens,
            l.outputTokens,
            l.costUsd.toFixed(4),
          ]
            .map(csvCell)
            .join(','),
        ),
      ].join('\n');
    }
    return [
      `${board.name}, ${month}`,
      ...lines.map(
        (l) =>
          `  ${l.school}: ${l.requests} requests, ${money(l.costUsd)}${l.aiEnabled ? '' : ' (AI off)'}`,
      ),
      `  Total: ${money(total)}`,
    ].join('\n');
  },
};
