/**
 * Library reviewers designated by the board (DECISIONS D-064) and the curriculum import (D-070).
 */
import { LICENCE_WARNING, parseCurriculumFile } from '@lynx/content';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  describePlan,
  formatErrors,
  planCurriculumImport,
  planIsEmpty,
  type ExistingExpectation,
  type PlannedExpectation,
} from '../curriculum';
import {
  bool,
  boardBySlug,
  check,
  CliError,
  inChunks,
  need,
  type CliContext,
  type Command,
} from '../context';

/** Every attente of a subject's curriculum version (paged: the API returns 1,000 rows at most). */
async function versionExpectations(
  ctx: CliContext,
  subjectId: string,
  version: string,
): Promise<ExistingExpectation[]> {
  const rows: ExistingExpectation[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ctx.db
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

export const libraryCommands: Record<string, Command> = {
  async 'set-library-reviewer'(ctx) {
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    const email = need(ctx, 'email').toLowerCase();
    const user = check(
      await ctx.db.from('users').select('id, display_name').eq('email', email).maybeSingle(),
      `user ${email}`,
    );
    const { data: current, error: readError } = await ctx.db
      .from('library_reviewers')
      .select('approves_content, reviews_faith')
      .eq('board_id', board.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw new CliError(`library reviewers: ${readError.message}`);
    const approvesContent = bool(ctx, 'content') ?? current?.approves_content ?? true;
    const reviewsFaith = bool(ctx, 'faith') ?? current?.reviews_faith ?? false;

    if (!approvesContent && !reviewsFaith) {
      if (!current)
        return `${email} is not a library reviewer for ${board.name}: nothing to remove.`;
      const { error } = await ctx.db
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
    const { error } = await ctx.db.from('library_reviewers').upsert(
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

  async 'list-library-reviewers'(ctx) {
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    const { data, error } = await ctx.db
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

  async 'import-curriculum'(ctx) {
    const given = need(ctx, 'file');
    // pnpm runs the CLI from apps/admin: the path is relative to where `pnpm admin` was run.
    const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new CliError(`cannot read ${file}`);
    }
    const parsed = parseCurriculumFile(text, {
      confirmLicence: ctx.values['confirm-licence'] === true,
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
      await ctx.db
        .from('subjects')
        .select('id, label_fr, grade_min, grade_max')
        .eq('code', data.subjectCode)
        .is('board_id', null)
        .maybeSingle(),
      `standard subject "${data.subjectCode}"`,
    );
    const grades = check(await ctx.db.from('grades').select('code, ordinal'), 'grades');
    const strands = await ctx.db
      .from('strands')
      .select('id, code, label_fr, label_en, sort_order')
      .eq('subject_id', subject.id)
      .eq('curriculum_version', data.curriculumVersion);
    if (strands.error) throw new CliError(`strands: ${strands.error.message}`);

    const plan = planCurriculumImport(data, {
      grades: new Map(grades.map((g) => [g.code, g.ordinal])),
      subject: { gradeMin: subject.grade_min, gradeMax: subject.grade_max },
      strands: strands.data ?? [],
      expectations: await versionExpectations(ctx, subject.id, data.curriculumVersion),
    });
    if (plan.errors.length) {
      throw new CliError(`${given} does not fit the database:\n${formatErrors(plan.errors)}`);
    }
    const report = `${given}\n${describePlan(data, subject.label_fr, plan)}`;
    if (!ctx.values.apply)
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
        ctx.db.from('strands').upsert(chunk, { onConflict: 'subject_id,curriculum_version,code' }),
      'strands',
    );
    const strandIds = check(
      await ctx.db
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
      (chunk) => ctx.db.from('curriculum_expectations').upsert(chunk, { onConflict }),
      'overall attentes',
    );
    const overallId = new Map(
      (await versionExpectations(ctx, subject.id, data.curriculumVersion))
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
      (chunk) => ctx.db.from('curriculum_expectations').upsert(chunk, { onConflict }),
      'specific attentes',
    );

    // Attente texts are part of every linked item's search document (D-068).
    const { data: refreshed, error } = await ctx.db.rpc('library_refresh_search_all');
    if (error) throw new CliError(`library search documents: ${error.message}`);
    const strandCount = plan.strands.filter((s) => s.change !== 'unchanged').length;
    return [
      report,
      `Imported: ${strandCount} strand(s) and ${toWrite.length} attente(s) written.`,
      `Search documents rebuilt for ${refreshed} library item(s).`,
    ].join('\n');
  },
};
