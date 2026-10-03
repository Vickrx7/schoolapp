/**
 * DECISIONS D-119: no personal value in an API query string. PostgREST puts filters in the URL,
 * and the hosted API gateway's logs record URLs, so every command that takes an e-mail address
 * finds the person with `operator_account_id` (the address in the request body) and names them
 * by id afterwards. Each such command runs here against a fake of the API that records every
 * request; the ESLint rule (eslint.config.mjs, pinned by no-personal-query-strings.test.ts in the
 * web app) keeps new code from filtering on an address.
 */
import type { AdminEnv } from '@lynx/config';
import type { Database } from '@lynx/db';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import type { CliContext } from '../context';
import { commands } from './index';

const EMAIL = 'Prof.Exemple@conseil.ca';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const BOARD = { id: '22222222-2222-4222-8222-222222222222', name: 'Conseil exemple' };
const SCHOOL = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'École exemple',
  board_id: BOARD.id,
};

interface Call {
  method: string;
  url: string;
  body: string;
}

/** A Supabase API that answers every request with plausible rows, and records them. */
function fakeApi(account: string | null) {
  const calls: Call[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url: request.url, body: await request.text() });

    if (url.pathname === '/rest/v1/rpc/operator_account_id') return json(account);
    if (url.pathname.startsWith('/auth/v1/admin/users')) {
      return json({ id: USER_ID, aud: 'authenticated', role: 'authenticated', app_metadata: {} });
    }
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    const row =
      table === 'boards'
        ? BOARD
        : table === 'schools'
          ? SCHOOL
          : table === 'library_reviewers'
            ? { approves_content: true, reviews_faith: false }
            : table === 'rpc/operator_delete_staff_account'
              ? { profile: true, boards: 1, roles: 1 }
              : table === 'rpc/operator_set_staff_active'
                ? true
                : { id: USER_ID };
    const prefer = request.headers.get('prefer') ?? '';
    if (
      request.method !== 'GET' &&
      !table.startsWith('rpc/') &&
      !prefer.includes('return=representation')
    ) {
      return new Response(null, { status: 201 });
    }
    const single = request.headers.get('accept')?.includes('vnd.pgrst.object');
    return json(single || table.startsWith('rpc/') ? row : [row]);
  };
  const db = createClient<Database>('https://api.example.test', 'service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

async function run(argv: string[], account: string | null = USER_ID) {
  const { command, values } = parseCli(argv);
  const { db, calls } = fakeApi(account);
  const ctx: CliContext = { values, env: {} as AdminEnv, db };
  let outcome: string | Error;
  try {
    outcome = await commands[command!]!(ctx);
  } catch (error) {
    outcome = error as Error;
  }
  return { outcome, calls };
}

/** No address in any URL, as typed or encoded; it went in the lookup's body instead. */
function expectNoAddressInUrls(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    const url = decodeURIComponent(call.url).toLowerCase();
    expect(url, `${call.method} ${call.url}`).not.toContain('@');
    expect(url, `${call.method} ${call.url}`).not.toContain('prof.exemple');
  }
  const lookup = calls.find((c) => c.url.endsWith('/rest/v1/rpc/operator_account_id'));
  expect(lookup?.method).toBe('POST');
  expect(JSON.parse(lookup!.body)).toEqual({ p_email: EMAIL.toLowerCase() });
}

describe('commands that take an e-mail address keep it out of URLs (D-119)', () => {
  it('invite: a new account (with the authenticated role) and a returning one', async () => {
    const fresh = await run(
      [
        'invite',
        '--email',
        EMAIL,
        '--name',
        'Prof Exemple',
        '--role',
        'teacher',
        '--school',
        'conseil/ecole',
      ],
      null,
    );
    expect(fresh.outcome).toMatch(/can now sign in as teacher/);
    expectNoAddressInUrls(fresh.calls);
    const created = fresh.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/auth/v1/admin/users'),
    );
    expect(JSON.parse(created!.body)).toMatchObject({
      email: EMAIL.toLowerCase(),
      email_confirm: true,
      role: 'authenticated',
    });

    const again = await run([
      'invite',
      '--email',
      EMAIL,
      '--name',
      'Prof Exemple',
      '--role',
      'board_admin',
      '--board',
      'conseil',
    ]);
    expect(again.outcome).toMatch(/can now sign in as board_admin/);
    expectNoAddressInUrls(again.calls);
    // A returning person gets their access back as « Rétablir l'accès » gives it (audited).
    const restored = again.calls.find((c) => c.url.endsWith('/rpc/operator_set_staff_active'));
    expect(JSON.parse(restored!.body)).toEqual({ p_user_id: USER_ID, p_active: true });
    const unbanned = again.calls.find((c) => c.method === 'PUT' && c.url.includes(USER_ID));
    expect(JSON.parse(unbanned!.body)).toMatchObject({ ban_duration: 'none' });
  });

  it('deactivate', async () => {
    const { outcome, calls } = await run(['deactivate', '--email', EMAIL]);
    expect(outcome).toMatch(/is deactivated/);
    expectNoAddressInUrls(calls);
    // As « Retirer l'accès »: through the database, audited for the board (D-106).
    const removed = calls.find((c) => c.url.endsWith('/rpc/operator_set_staff_active'));
    expect(JSON.parse(removed!.body)).toEqual({ p_user_id: USER_ID, p_active: false });
    const banned = calls.find((c) => c.method === 'PUT' && c.url.includes(USER_ID));
    expect(JSON.parse(banned!.body)).toMatchObject({ ban_duration: '876000h' });
  });

  it('set-library-reviewer', async () => {
    const { outcome, calls } = await run([
      'set-library-reviewer',
      '--board',
      'conseil',
      '--email',
      EMAIL,
      '--content',
      'true',
      '--faith',
      'true',
    ]);
    expect(outcome).toMatch(/now reviews content and faith content/);
    expectNoAddressInUrls(calls);
  });

  it('delete-user', async () => {
    const { outcome, calls } = await run(['delete-user', '--email', EMAIL, '--yes']);
    expect(outcome).toMatch(/^Deleted/);
    expectNoAddressInUrls(calls);
  });

  it('an unknown address is refused after the lookup alone', async () => {
    for (const argv of [
      ['deactivate', '--email', EMAIL],
      ['set-library-reviewer', '--board', 'conseil', '--email', EMAIL],
      ['delete-user', '--email', EMAIL, '--yes'],
    ]) {
      const { outcome, calls } = await run(argv, null);
      expect(outcome, argv[0]).toBeInstanceOf(Error);
      expectNoAddressInUrls(calls);
    }
  });
});
