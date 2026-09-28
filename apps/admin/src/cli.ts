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
 */
import { loadEnv } from '@lynx/config';
import { Constants, type Database } from '@lynx/db';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import { z } from 'zod';

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
