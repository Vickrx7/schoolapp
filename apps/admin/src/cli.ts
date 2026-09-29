/**
 * Admin CLI for onboarding boards, schools and staff (accounts are invite-only).
 * Uses the service role key, so run it only from a trusted machine.
 *
 *   pnpm admin create-board --name "Conseil scolaire ..." --slug csc-exemple
 *   pnpm admin create-school --board csc-exemple --name "École ..." --slug ecole-a [--timezone America/Toronto] [--cycle 6]
 *   pnpm admin create-year --board csc-exemple --name 2026-2027 --starts 2026-09-02 --ends 2027-06-25
 *   pnpm admin invite --email prof@conseil.ca --name "Isabelle Tremblay" --role teacher --school csc-exemple/ecole-a
 *   pnpm admin invite --email admin@conseil.ca --name "Nathalie Roy" --role board_admin --board csc-exemple
 *   pnpm admin deactivate --email prof@conseil.ca
 *   pnpm admin set-module --school csc-exemple/ecole-a --module library --enabled false
 *
 * AI budgets (US dollars of provider cost per month; see DECISIONS.md, D-040):
 *   pnpm admin set-ai-budget --school csc-exemple/ecole-a --allowance 100 [--ceiling 200] [--plan plus]
 *   pnpm admin set-ai-board --board csc-exemple [--allowed true] [--default-allowance 50] [--ceiling-multiplier 2] [--pooling true]
 *   pnpm admin ai-usage --board csc-exemple [--month 2026-10] [--csv]
 *
 * Library reviewers designated by the board (see DECISIONS.md, D-064). --content approves
 * resources for the board, --faith reviews faith content; an omitted flag keeps its current value
 * (true and false for a new reviewer), and both false removes the designation:
 *   pnpm admin set-library-reviewer --board csc-exemple --email conseillere@conseil.ca --content true --faith true
 *   pnpm admin list-library-reviewers --board csc-exemple
 *
 * Curriculum import (JSON only; see DECISIONS.md, D-070 and D-030). A dry run unless --apply:
 * it validates the file, compares it with the database and says what would change. A file that
 * says it holds official or verified text needs --confirm-licence. The file holds one standard
 * subject's whole curriculum version (sort orders follow the file); strands and attentes are
 * upserted by code, never deleted, and every library search document is rebuilt. Re-running the
 * same file changes nothing. tools/fixtures/curriculum-sample.json is an example (4e année
 * Français summaries, unverified):
 *   pnpm admin import-curriculum --file tools/fixtures/curriculum-sample.json [--apply] [--confirm-licence]
 */
import { loadEnv } from '@lynx/config';
import { LICENCE_WARNING, parseCurriculumFile } from '@lynx/content';
import { Constants, type Database, type Json } from '@lynx/db';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  describePlan,
  formatErrors,
  planCurriculumImport,
  planIsEmpty,
  type ExistingExpectation,
  type PlannedExpectation,
} from './curriculum';

const env = loadEnv(
  z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  }),
);

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    'short-name': { type: 'string' },
    board: { type: 'string' },
    school: { type: 'string' },
    timezone: { type: 'string' },
    cycle: { type: 'string' },
    starts: { type: 'string' },
    ends: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
    honorific: { type: 'string' },
    module: { type: 'string' },
    enabled: { type: 'string' },
    allowance: { type: 'string' },
    ceiling: { type: 'string' },
    plan: { type: 'string' },
    allowed: { type: 'string' },
    'default-allowance': { type: 'string' },
    'ceiling-multiplier': { type: 'string' },
    pooling: { type: 'string' },
    month: { type: 'string' },
    csv: { type: 'boolean' },
    content: { type: 'string' },
    faith: { type: 'string' },
    file: { type: 'string' },
    apply: { type: 'boolean' },
    'confirm-licence': { type: 'boolean' },
  },
});

class CliError extends Error {}

function need(key: keyof typeof values): string {
  const v = values[key];
  if (typeof v !== 'string' || v.trim() === '') throw new CliError(`--${key} is required`);
  return v.trim();
}

function check<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> {
  if (result.error) throw new CliError(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new CliError(`${what}: not found`);
  return result.data as NonNullable<T>;
}

async function boardBySlug(slug: string) {
  return check(
    await db.from('boards').select('id, name').eq('slug', slug).maybeSingle(),
    `board "${slug}"`,
  );
}

/** "board-slug/school-slug" */
async function schoolByPath(path: string) {
  const [boardSlug, schoolSlug] = path.split('/');
  if (!boardSlug || !schoolSlug)
    throw new CliError('--school must look like board-slug/school-slug');
  const board = await boardBySlug(boardSlug);
  const school = check(
    await db
      .from('schools')
      .select('id, name, board_id')
      .eq('board_id', board.id)
      .eq('slug', schoolSlug)
      .maybeSingle(),
    `school "${path}"`,
  );
  return { board, school };
}

async function findAuthUserId(email: string): Promise<string | null> {
  const { data } = await db.from('users').select('id').eq('email', email).maybeSingle();
  if (data) return data.id;
  // Not in our profile table yet: look through auth users (small installs; paged).
  for (let page = 1; page < 50; page++) {
    const { data: list, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new CliError(`listing users: ${error.message}`);
    const found = list.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (list.users.length < 200) return null;
  }
  return null;
}

const money = (n: number) => `${n.toFixed(2)} USD`;
const bool = (key: keyof typeof values) => {
  const v = values[key];
  if (v === undefined) return undefined;
  if (v !== 'true' && v !== 'false') throw new CliError(`--${key} must be true or false`);
  return v === 'true';
};
const amount = (key: keyof typeof values) => {
  const v = values[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new CliError(`--${key} must be a positive number`);
  return n;
};

/** The calendar month (YYYY-MM) a timestamp falls in, in a school's time zone. */
function monthIn(timeZone: string, iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Every attente of a subject's curriculum version (paged: the API returns 1,000 rows at most). */
async function versionExpectations(
  subjectId: string,
  version: string,
): Promise<ExistingExpectation[]> {
  const rows: ExistingExpectation[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('curriculum_expectations')
      .select(
        'id, grade_code, code, kind, strand_id, parent_id, text_fr, text_en, is_verified, source_note, sort_order',
      )
      .eq('subject_id', subjectId)
      .eq('curriculum_version', version)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new CliError(`attentes: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** Writes rows 500 at a time; each call is one statement. */
async function inChunks<T>(
  rows: readonly T[],
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
  what: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await write(rows.slice(i, i + 500));
    if (error) throw new CliError(`${what}: ${error.message}`);
  }
}

const commands: Record<string, () => Promise<string>> = {
  async 'create-board'() {
    const board = check(
      await db
        .from('boards')
        .insert({
          name: need('name'),
          slug: need('slug'),
          short_name: values['short-name'] ?? null,
        })
        .select('id')
        .single(),
      'create board',
    );
    const { error } = await db.rpc('provision_board_defaults', { p_board_id: board.id });
    if (error) throw new CliError(`default language levels: ${error.message}`);
    return `Board created (${board.id}) with default language levels.`;
  },

  async 'create-school'() {
    const board = await boardBySlug(need('board'));
    const cycle = values.cycle ? Number(values.cycle) : null;
    const school = check(
      await db
        .from('schools')
        .insert({
          board_id: board.id,
          name: need('name'),
          slug: need('slug'),
          short_name: values['short-name'] ?? null,
          timezone: values.timezone ?? 'America/Toronto',
          schedule_type: cycle ? 'cycle' : 'weekly',
          cycle_length: cycle,
        })
        .select('id')
        .single(),
      'create school',
    );
    const { error } = await db.rpc('provision_school_defaults', { p_school_id: school.id });
    if (error) throw new CliError(`pilot modules: ${error.message}`);
    return `School created (${school.id}) with the pilot modules (core, teaching, library).`;
  },

  async 'create-year'() {
    const board = await boardBySlug(need('board'));
    check(
      await db
        .from('school_years')
        .insert({
          board_id: board.id,
          name: need('name'),
          starts_on: need('starts'),
          ends_on: need('ends'),
        })
        .select('id')
        .single(),
      'create school year',
    );
    return `School year ${values.name} created for ${board.name}.`;
  },

  async invite() {
    const email = need('email').toLowerCase();
    const role = z.enum(Constants.public.Enums.app_role).parse(need('role'));
    const target =
      role === 'board_admin'
        ? { board: await boardBySlug(need('board')), school: null }
        : await schoolByPath(need('school'));

    let userId = await findAuthUserId(email);
    if (!userId) {
      // Pre-confirmed account: the person signs in with the emailed code; no password.
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new CliError(`create auth user: ${error?.message}`);
      userId = data.user.id;
    } else {
      // Re-inviting someone who was deactivated lifts the sign-in block.
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) throw new CliError(`unblock sign-in: ${error.message}`);
    }
    check(
      await db
        .from('users')
        .upsert(
          {
            id: userId,
            email,
            display_name: need('name'),
            honorific: values.honorific ?? null,
            deactivated_at: null,
          },
          { onConflict: 'id' },
        )
        .select('id')
        .single(),
      'save profile',
    );
    const { error } = await db.from('user_roles').insert({
      user_id: userId,
      role,
      board_id: target.board.id,
      school_id: target.school?.id ?? null,
    });
    if (error && error.code !== '23505') throw new CliError(`grant role: ${error.message}`);
    return `${email} can now sign in as ${role}${target.school ? ` at ${target.school.name}` : ` for ${target.board.name}`}.`;
  },

  async deactivate() {
    const email = need('email').toLowerCase();
    const data = check(
      await db
        .from('users')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('email', email)
        .select('id')
        .maybeSingle(),
      `user ${email}`,
    );
    // Block sign-in at the auth level too (the database already denies all access).
    const { error } = await db.auth.admin.updateUserById(data.id, { ban_duration: '876000h' });
    if (error) throw new CliError(`block sign-in: ${error.message}`);
    return `${email} is deactivated: they can no longer sign in or see any data.`;
  },

  async 'set-module'() {
    const { school } = await schoolByPath(need('school'));
    const module = z.enum(Constants.public.Enums.module_key).parse(need('module'));
    const enabled = (values.enabled ?? 'true') === 'true';
    check(
      await db
        .from('module_entitlements')
        .upsert({ school_id: school.id, module, enabled }, { onConflict: 'school_id,module' })
        .select('id')
        .single(),
      'set module',
    );
    return `Module ${module} is now ${enabled ? 'enabled' : 'disabled'} for ${school.name}.`;
  },

  async 'set-ai-budget'() {
    const { school } = await schoolByPath(need('school'));
    const allowance = amount('allowance');
    if (allowance === undefined) throw new CliError('--allowance is required');
    const ceiling = amount('ceiling');
    if (ceiling !== undefined && ceiling < allowance)
      throw new CliError('--ceiling must be at least the allowance');
    check(
      await db
        .from('ai_budgets')
        .upsert(
          {
            school_id: school.id,
            monthly_allowance_usd: allowance,
            monthly_ceiling_usd: ceiling ?? null,
            plan: values.plan?.trim() || null,
          },
          { onConflict: 'school_id' },
        )
        .select('school_id')
        .single(),
      'set AI budget',
    );
    return `${school.name}: ${money(allowance)} per month${ceiling !== undefined ? `, up to ${money(ceiling)} with the board pool` : ''}.`;
  },

  async 'set-ai-board'() {
    const slug = need('board');
    const board = check(
      await db.from('boards').select('id, name, settings').eq('slug', slug).maybeSingle(),
      `board "${slug}"`,
    );
    const settings = (board.settings ?? {}) as Record<string, unknown>;
    const ai = { ...((settings.ai as Record<string, unknown> | undefined) ?? {}) };
    const allowed = bool('allowed');
    const pooling = bool('pooling');
    const defaultAllowance = amount('default-allowance');
    const multiplier = amount('ceiling-multiplier');
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
      await db
        .from('boards')
        .update({ settings: { ...settings, ai } as Json })
        .eq('id', board.id)
        .select('id')
        .single(),
      'update board',
    );
    return `${board.name} AI settings: ${JSON.stringify(ai)}`;
  },

  async 'ai-usage'() {
    const board = await boardBySlug(need('board'));
    const month = values.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new CliError('--month must look like 2026-10');
    const { data: schools } = await db
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
      const { data, error } = await db
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
    if (values.csv) {
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

  async 'set-library-reviewer'() {
    const board = await boardBySlug(need('board'));
    const email = need('email').toLowerCase();
    const user = check(
      await db.from('users').select('id, display_name').eq('email', email).maybeSingle(),
      `user ${email}`,
    );
    const { data: current, error: readError } = await db
      .from('library_reviewers')
      .select('approves_content, reviews_faith')
      .eq('board_id', board.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw new CliError(`library reviewers: ${readError.message}`);
    const approvesContent = bool('content') ?? current?.approves_content ?? true;
    const reviewsFaith = bool('faith') ?? current?.reviews_faith ?? false;

    if (!approvesContent && !reviewsFaith) {
      if (!current)
        return `${email} is not a library reviewer for ${board.name}: nothing to remove.`;
      const { error } = await db
        .from('library_reviewers')
        .delete()
        .eq('board_id', board.id)
        .eq('user_id', user.id);
      if (error) throw new CliError(`remove reviewer: ${error.message}`);
      return `${email} no longer reviews library resources for ${board.name}.`;
    }
    const roles = [approvesContent && 'content', reviewsFaith && 'faith content']
      .filter(Boolean)
      .join(' and ');
    if (
      current &&
      current.approves_content === approvesContent &&
      current.reviews_faith === reviewsFaith
    ) {
      return `${email} already reviews ${roles} for ${board.name}.`;
    }
    const { error } = await db.from('library_reviewers').upsert(
      {
        board_id: board.id,
        user_id: user.id,
        approves_content: approvesContent,
        reviews_faith: reviewsFaith,
      },
      { onConflict: 'board_id,user_id' },
    );
    // The database's guard: a reviewer is active staff of the board (any role but parent).
    if (error?.code === '22023')
      throw new CliError(`${email} is not active staff of ${board.name}: invite them first.`);
    if (error) throw new CliError(`designate reviewer: ${error.message}`);
    return `${email} now reviews ${roles} for ${board.name}.`;
  },

  async 'list-library-reviewers'() {
    const board = await boardBySlug(need('board'));
    const { data, error } = await db
      .from('library_reviewers')
      .select('approves_content, reviews_faith, users!inner(email, display_name, deactivated_at)')
      .eq('board_id', board.id);
    if (error) throw new CliError(`library reviewers: ${error.message}`);
    const rows = (data ?? []).sort((a, b) => a.users.email.localeCompare(b.users.email));
    if (!rows.length) return `${board.name}: no library reviewers yet.`;
    return [
      `${board.name}: ${rows.length} library reviewer${rows.length > 1 ? 's' : ''}`,
      ...rows.map((r) => {
        const kinds = [r.approves_content && 'content', r.reviews_faith && 'faith']
          .filter(Boolean)
          .join(', ');
        const inactive = r.users.deactivated_at ? ' (deactivated: no access)' : '';
        return `  ${r.users.email} (${r.users.display_name}): ${kinds}${inactive}`;
      }),
    ].join('\n');
  },

  async 'import-curriculum'() {
    const given = need('file');
    // pnpm runs the CLI from apps/admin: the path is relative to where `pnpm admin` was run.
    const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new CliError(`cannot read ${file}`);
    }
    const parsed = parseCurriculumFile(text, {
      confirmLicence: values['confirm-licence'] === true,
    });
    if (parsed.errors.some((e) => e.message === 'licenceConfirmationRequired')) {
      throw new CliError(LICENCE_WARNING);
    }
    if (!parsed.data) {
      throw new CliError(
        `${given} is not a valid curriculum file:\n${formatErrors(parsed.errors)}`,
      );
    }
    const data = parsed.data;
    // Confirmed: the warning is still printed, so the operator sees what they confirmed (D-030).
    if (data.official || data.verified) {
      console.warn(`Licence confirmed with --confirm-licence.\n${LICENCE_WARNING}\n`);
    }

    const subject = check(
      await db
        .from('subjects')
        .select('id, label_fr, grade_min, grade_max')
        .eq('code', data.subjectCode)
        .is('board_id', null)
        .maybeSingle(),
      `standard subject "${data.subjectCode}"`,
    );
    const grades = check(await db.from('grades').select('code, ordinal'), 'grades');
    const strands = await db
      .from('strands')
      .select('id, code, label_fr, label_en, sort_order')
      .eq('subject_id', subject.id)
      .eq('curriculum_version', data.curriculumVersion);
    if (strands.error) throw new CliError(`strands: ${strands.error.message}`);

    const plan = planCurriculumImport(data, {
      grades: new Map(grades.map((g) => [g.code, g.ordinal])),
      subject: { gradeMin: subject.grade_min, gradeMax: subject.grade_max },
      strands: strands.data ?? [],
      expectations: await versionExpectations(subject.id, data.curriculumVersion),
    });
    if (plan.errors.length) {
      throw new CliError(`${given} does not fit the database:\n${formatErrors(plan.errors)}`);
    }
    const report = `${given}\n${describePlan(data, subject.label_fr, plan)}`;
    if (!values.apply)
      return `${report}\nDry run: nothing was written. Re-run with --apply to import.`;
    if (planIsEmpty(plan)) return `${report}\nNothing to import: the database already matches.`;

    // Strands, then overall attentes, then specific ones (they point at their overall attente).
    const version = { subject_id: subject.id, curriculum_version: data.curriculumVersion };
    await inChunks(
      plan.strands
        .filter((s) => s.change !== 'unchanged')
        .map((s) => ({
          ...version,
          code: s.code,
          label_fr: s.label_fr,
          label_en: s.label_en,
          sort_order: s.sort_order,
        })),
      (chunk) =>
        db.from('strands').upsert(chunk, { onConflict: 'subject_id,curriculum_version,code' }),
      'strands',
    );
    const strandIds = check(
      await db
        .from('strands')
        .select('id, code')
        .eq('subject_id', subject.id)
        .eq('curriculum_version', data.curriculumVersion),
      'strands',
    );
    const strandId = new Map(strandIds.map((s) => [s.code, s.id]));
    const row = (e: PlannedExpectation, parentId: string | null) => ({
      ...version,
      grade_code: e.grade_code,
      code: e.code,
      kind: e.kind,
      strand_id: e.strandCode === null ? null : (strandId.get(e.strandCode) ?? null),
      parent_id: parentId,
      text_fr: e.text_fr,
      text_en: e.text_en,
      is_verified: e.is_verified,
      source_note: e.source_note,
      sort_order: e.sort_order,
    });
    const onConflict = 'subject_id,grade_code,curriculum_version,code';
    const toWrite = plan.expectations.filter((e) => e.change !== 'unchanged');
    await inChunks(
      toWrite.filter((e) => e.kind === 'overall').map((e) => row(e, null)),
      (chunk) => db.from('curriculum_expectations').upsert(chunk, { onConflict }),
      'overall attentes',
    );
    const overallId = new Map(
      (await versionExpectations(subject.id, data.curriculumVersion))
        .filter((e) => e.kind === 'overall')
        .map((e) => [`${e.grade_code}:${e.code}`, e.id]),
    );
    await inChunks(
      toWrite
        .filter((e) => e.kind === 'specific')
        .map((e) => {
          const parent = overallId.get(`${e.grade_code}:${e.parentCode}`);
          if (!parent)
            throw new CliError(`overall attente ${e.grade_code} ${e.parentCode} not found`);
          return row(e, parent);
        }),
      (chunk) => db.from('curriculum_expectations').upsert(chunk, { onConflict }),
      'specific attentes',
    );

    // Attente texts are part of every linked item's search document (D-068).
    const { data: refreshed, error } = await db.rpc('library_refresh_search_all');
    if (error) throw new CliError(`library search documents: ${error.message}`);
    const strandCount = plan.strands.filter((s) => s.change !== 'unchanged').length;
    return [
      report,
      `Imported: ${strandCount} strand(s) and ${toWrite.length} attente(s) written.`,
      `Search documents rebuilt for ${refreshed} library item(s).`,
    ].join('\n');
  },
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.error(
    `Usage: pnpm admin <${Object.keys(commands).join('|')}> [options]\nSee apps/admin/src/cli.ts for examples.`,
  );
  process.exit(1);
}
try {
  console.log(await run());
} catch (err) {
  if (err instanceof z.ZodError)
    console.error(`Error: ${err.issues.map((i) => i.message).join('; ')}`);
  else console.error(err instanceof CliError ? `Error: ${err.message}` : err);
  process.exit(1);
}
