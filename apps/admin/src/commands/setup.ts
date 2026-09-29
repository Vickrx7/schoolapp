/**
 * Boards, schools, school years, staff accounts (invite-only) and module entitlements.
 */
import { Constants } from '@lynx/db';
import { z } from 'zod';
import {
  boardBySlug,
  check,
  CliError,
  need,
  schoolByPath,
  type CliContext,
  type Command,
} from '../context';

async function findAuthUserId(ctx: CliContext, email: string): Promise<string | null> {
  const { data } = await ctx.db.from('users').select('id').eq('email', email).maybeSingle();
  if (data) return data.id;
  // Not in our profile table yet: look through auth users (small installs; paged).
  for (let page = 1; page < 50; page++) {
    const { data: list, error } = await ctx.db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new CliError(`listing users: ${error.message}`);
    const found = list.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (list.users.length < 200) return null;
  }
  return null;
}

export const setupCommands: Record<string, Command> = {
  async 'create-board'(ctx) {
    const board = check(
      await ctx.db
        .from('boards')
        .insert({
          name: need(ctx, 'name'),
          slug: need(ctx, 'slug'),
          short_name: ctx.values['short-name'] ?? null,
        })
        .select('id')
        .single(),
      'create board',
    );
    const { error } = await ctx.db.rpc('provision_board_defaults', { p_board_id: board.id });
    if (error) throw new CliError(`default language levels: ${error.message}`);
    return `Board created (${board.id}) with default language levels.`;
  },

  async 'create-school'(ctx) {
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    const cycle = ctx.values.cycle ? Number(ctx.values.cycle) : null;
    const school = check(
      await ctx.db
        .from('schools')
        .insert({
          board_id: board.id,
          name: need(ctx, 'name'),
          slug: need(ctx, 'slug'),
          short_name: ctx.values['short-name'] ?? null,
          timezone: ctx.values.timezone ?? 'America/Toronto',
          schedule_type: cycle ? 'cycle' : 'weekly',
          cycle_length: cycle,
        })
        .select('id')
        .single(),
      'create school',
    );
    const { error } = await ctx.db.rpc('provision_school_defaults', { p_school_id: school.id });
    if (error) throw new CliError(`pilot modules: ${error.message}`);
    return `School created (${school.id}) with the pilot modules (core, teaching, library).`;
  },

  async 'create-year'(ctx) {
    const board = await boardBySlug(ctx, need(ctx, 'board'));
    check(
      await ctx.db
        .from('school_years')
        .insert({
          board_id: board.id,
          name: need(ctx, 'name'),
          starts_on: need(ctx, 'starts'),
          ends_on: need(ctx, 'ends'),
        })
        .select('id')
        .single(),
      'create school year',
    );
    return `School year ${ctx.values.name} created for ${board.name}.`;
  },

  async invite(ctx) {
    const email = need(ctx, 'email').toLowerCase();
    const role = z.enum(Constants.public.Enums.app_role).parse(need(ctx, 'role'));
    const target =
      role === 'board_admin'
        ? { board: await boardBySlug(ctx, need(ctx, 'board')), school: null }
        : await schoolByPath(ctx, need(ctx, 'school'));

    let userId = await findAuthUserId(ctx, email);
    if (!userId) {
      // Pre-confirmed account: the person signs in with the emailed code; no password.
      const { data, error } = await ctx.db.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new CliError(`create auth user: ${error?.message}`);
      userId = data.user.id;
    } else {
      // Re-inviting someone who was deactivated lifts the sign-in block.
      const { error } = await ctx.db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) throw new CliError(`unblock sign-in: ${error.message}`);
    }
    check(
      await ctx.db
        .from('users')
        .upsert(
          {
            id: userId,
            email,
            display_name: need(ctx, 'name'),
            honorific: ctx.values.honorific ?? null,
            deactivated_at: null,
          },
          { onConflict: 'id' },
        )
        .select('id')
        .single(),
      'save profile',
    );
    const { error } = await ctx.db.from('user_roles').insert({
      user_id: userId,
      role,
      board_id: target.board.id,
      school_id: target.school?.id ?? null,
    });
    if (error && error.code !== '23505') throw new CliError(`grant role: ${error.message}`);
    return `${email} can now sign in as ${role}${target.school ? ` at ${target.school.name}` : ` for ${target.board.name}`}.`;
  },

  async deactivate(ctx) {
    const email = need(ctx, 'email').toLowerCase();
    const data = check(
      await ctx.db
        .from('users')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('email', email)
        .select('id')
        .maybeSingle(),
      `user ${email}`,
    );
    // Block sign-in at the auth level too (the database already denies all access).
    const { error } = await ctx.db.auth.admin.updateUserById(data.id, { ban_duration: '876000h' });
    if (error) throw new CliError(`block sign-in: ${error.message}`);
    return `${email} is deactivated: they can no longer sign in or see any data.`;
  },

  async 'set-module'(ctx) {
    const { school } = await schoolByPath(ctx, need(ctx, 'school'));
    const module = z.enum(Constants.public.Enums.module_key).parse(need(ctx, 'module'));
    const enabled = (ctx.values.enabled ?? 'true') === 'true';
    check(
      await ctx.db
        .from('module_entitlements')
        .upsert({ school_id: school.id, module, enabled }, { onConflict: 'school_id,module' })
        .select('id')
        .single(),
      'set module',
    );
    return `Module ${module} is now ${enabled ? 'enabled' : 'disabled'} for ${school.name}.`;
  },
};
