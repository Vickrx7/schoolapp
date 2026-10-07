/**
 * Boards, schools, school years, staff accounts (invite-only) and module entitlements.
 */
import { Constants } from '@lynx/db';
import { z } from 'zod';
import {
  accountIdByEmail,
  boardBySlug,
  check,
  CliError,
  need,
  schoolByPath,
  type Command,
} from '../context';

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

    // The profile, else an Auth account without one (an interrupted invitation).
    const existing = await accountIdByEmail(ctx, email);
    let userId = existing;
    if (!userId) {
      // Pre-confirmed account: the person signs in with the emailed code; no password. The role
      // every signed-in person's token carries is set here, as the worker does (D-107), rather
      // than left to the Auth server's default group, which may be unset.
      const { data, error } = await ctx.db.auth.admin.createUser({
        email,
        email_confirm: true,
        role: 'authenticated',
      });
      if (error || !data.user) throw new CliError(`create auth user: ${error?.message}`);
      userId = data.user.id;
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
    if (existing) {
      // Someone whose access was removed gets it back as « Rétablir l'accès » gives it: audited
      // for the board and the school (D-106), plans refreshed; then the sign-in block is lifted
      // now (the worker does it too).
      const restored = await ctx.db.rpc('operator_set_staff_active', {
        p_user_id: userId,
        p_active: true,
      });
      if (restored.error) throw new CliError(`restore access: ${restored.error.message}`);
      const { error: unbanError } = await ctx.db.auth.admin.updateUserById(userId, {
        ban_duration: 'none',
        role: 'authenticated',
      });
      if (unbanError) throw new CliError(`unblock sign-in: ${unbanError.message}`);
    }
    return `${email} can now sign in as ${role}${target.school ? ` at ${target.school.name}` : ` for ${target.board.name}`}.`;
  },

  async deactivate(ctx) {
    const email = need(ctx, 'email').toLowerCase();
    const userId = await accountIdByEmail(ctx, email);
    if (!userId) throw new CliError(`user ${email}: not found`);
    // As « Retirer l'accès »: audited for the board and the school with IP Lynx as the actor
    // (D-106), plans refreshed, the worker told.
    const { data: changed, error } = await ctx.db.rpc('operator_set_staff_active', {
      p_user_id: userId,
      p_active: false,
    });
    if (error?.code === 'P0002') throw new CliError(`user ${email}: no profile`);
    if (error) throw new CliError(`deactivate ${email}: ${error.message}`);
    // Block sign-in at the auth level now (the database already denies all access).
    const { error: banError } = await ctx.db.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    });
    if (banError) throw new CliError(`block sign-in: ${banError.message}`);
    return changed
      ? `${email} is deactivated: they can no longer sign in or see any data.`
      : `${email} was already deactivated; their sign-in stays blocked.`;
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
