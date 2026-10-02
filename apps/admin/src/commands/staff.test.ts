import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdminEnv } from '@lynx/config';
import type { Database } from '@lynx/db';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext, type CliContext } from '../context';
import {
  auditExportCsv,
  deleteBoardErrorMessage,
  deletedAccountSummary,
  deletedBoardSummary,
  parseReason,
  staffCommands,
  staffErrorMessage,
  type AuditExportRow,
} from './staff';

/** A command run with no settings at all: it must refuse before reading them or the database. */
async function refusal(argv: string[]): Promise<string> {
  const { command, values } = parseCli(argv);
  try {
    await staffCommands[command!]!(createContext(values));
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('log-operator-access', () => {
  it('takes one of the four reasons the board reads in its audit log', () => {
    expect(parseReason('support')).toBe('support');
    expect(parseReason(' migration ')).toBe('migration');
    expect(() => parseReason(undefined)).toThrow(/--reason is required/);
    expect(() => parseReason('curiosity')).toThrow(/support, incident, restore, migration/);
  });

  it('refuses an unknown reason before anything else', async () => {
    expect(
      await refusal(['log-operator-access', '--board', 'csc-demo', '--reason', 'audit']),
    ).toMatch(/--reason must be one of/);
  });
});

describe('delete-user', () => {
  it('needs an address and --yes before it looks anything up', async () => {
    expect(await refusal(['delete-user'])).toMatch(/--email is required/);
    expect(await refusal(['delete-user', '--email', 'Prof@Conseil.ca'])).toMatch(
      /prof@conseil\.ca's account and data for good.*--yes/,
    );
  });

  it('explains the refusals of the database', () => {
    expect(staffErrorMessage({ code: 'LXU06', message: 'x' }, 'a@b.ca')).toMatch(
      /still has access.*deactivate --email a@b\.ca/,
    );
    expect(staffErrorMessage({ code: 'LXU02', message: 'x' }, 'a@b.ca')).toMatch(/--all-boards/);
    expect(staffErrorMessage({ code: '42501', message: 'permission denied' }, 'a@b.ca')).toBe(
      'delete a@b.ca: permission denied',
    );
  });

  it('says what was deleted', () => {
    expect(
      deletedAccountSummary(
        'a@b.ca',
        {
          profile: true,
          boards: 1,
          roles: 2,
          classes: 1,
          plans: 0,
          libraryItems: 3,
          feedback: 1,
          invitations: 2,
        },
        true,
      ),
    ).toBe(
      'Deleted a@b.ca (1 board): 2 role(s), 1 class(es) they alone led (with their students and plans), 0 other substitute plan(s), 3 private resource(s), 1 feedback message(s), 2 invitation(s). Shared resources stay, without an author. Its sign-in account is deleted.',
    );
    expect(deletedAccountSummary('a@b.ca', { profile: false }, true)).toBe(
      'a@b.ca had no profile, only a sign-in account. Its sign-in account is deleted.',
    );
  });
});

describe('delete-board', () => {
  it('needs the slug typed again, the export offered and --yes', async () => {
    expect(await refusal(['delete-board', '--board', 'csc-x', '--exported', '--yes'])).toMatch(
      /--confirm csc-x/,
    );
    expect(
      await refusal(['delete-board', '--board', 'csc-x', '--confirm', 'csc-y', '--exported']),
    ).toMatch(/--confirm csc-x/);
    expect(
      await refusal(['delete-board', '--board', 'csc-x', '--confirm', 'csc-x', '--yes']),
    ).toMatch(/library.*export-pack.*--exported.*export-audit/);
    expect(
      await refusal(['delete-board', '--board', 'csc-x', '--confirm', 'csc-x', '--exported']),
    ).toMatch(/for good, its audit log included.*--yes/);
  });

  it('says what was deleted', () => {
    expect(
      deletedBoardSummary(
        'CSC Exemple',
        {
          userIds: ['u1', 'u2'],
          schools: 2,
          classes: 5,
          libraryItems: 9,
          people: 2,
          auditRows: 120,
          auditRowsSinceExport: 1,
        },
        2,
      ),
    ).toBe(
      'Deleted CSC Exemple: 2 school(s), 5 class(es), 9 resource(s), 2 person(s) who worked there only (2 sign-in account(s) deleted), 120 audit row(s) (1 written after the export, not in its file). People who also work in another board keep their account there.',
    );
  });

  it('asks for the whole audit log first (D-122)', () => {
    expect(deleteBoardErrorMessage({ code: 'LXB01', message: 'x' }, 'csc-x')).toBe(
      "Export csc-x's whole audit log first (pnpm admin export-audit --board csc-x --out <file>), at most 7 days before, and give the file to the board.",
    );
    expect(deleteBoardErrorMessage({ code: '22023', message: 'slug' }, 'csc-x')).toBe(
      'delete board csc-x: slug',
    );
  });
});

const BOARD = { id: '22222222-2222-4222-8222-222222222222', name: 'Conseil exemple' };

/** An entry of the export, as `operator_export_audit` returns it. */
function entry(id: number, over: Partial<AuditExportRow> = {}): AuditExportRow {
  return {
    id,
    occurred_at: '2026-10-02T13:00:00+00:00',
    action: 'staff.invited',
    audience: 'direction_board',
    category: 'access',
    school_id: null,
    school_name: null,
    actor_type: 'user',
    actor_user_id: '11111111-1111-4111-8111-111111111111',
    actor_name: 'Nathalie Roy',
    entity_type: 'staff_invitation',
    entity_id: null,
    details: {},
    ...over,
  };
}

/** The API, answering the board lookup, the pages of the log and the export's record. */
function fakeAuditApi(total: number) {
  const calls: { path: string; body: string }[] = [];
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/rest/v1/boards') return json(BOARD);
    if (url.pathname === '/rest/v1/rpc/operator_export_audit') {
      const { p_after_id: after, p_limit: limit } = JSON.parse(body) as {
        p_after_id: number;
        p_limit: number;
      };
      const ids = Array.from({ length: total }, (_, i) => i + 1).filter((id) => id > after);
      return json(ids.slice(0, limit).map((id) => entry(id)));
    }
    if (url.pathname === '/rest/v1/rpc/operator_log_audit_export') return json(null);
    return new Response(null, { status: 404 });
  };
  const db = createClient<Database>('https://api.example.test', 'service-role-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

async function exportAudit(argv: string[], total: number) {
  const { values } = parseCli(['export-audit', ...argv]);
  const { db, calls } = fakeAuditApi(total);
  const ctx: CliContext = { values, env: {} as AdminEnv, db };
  return { outcome: await staffCommands['export-audit']!(ctx), calls };
}

describe('export-audit', () => {
  it('needs the board and the file before it reaches the database', async () => {
    expect(await refusal(['export-audit'])).toMatch(/--board is required/);
    expect(await refusal(['export-audit', '--board', 'csc-x'])).toMatch(/--out is required/);
  });

  it('writes every entry, page after page, then records the export with its count', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lynx-audit-'));
    const out = path.join(dir, 'journal.csv');
    const { outcome, calls } = await exportAudit(['--board', 'csc-x', '--out', out], 2345);
    expect(outcome).toMatch(/^Wrote 2345 audit entries of Conseil exemple to .*journal\.csv/);
    const pages = calls.filter((c) => c.path.endsWith('/rpc/operator_export_audit'));
    expect(pages.map((c) => JSON.parse(c.body).p_after_id)).toEqual([0, 1000, 2000]);
    const lines = readFileSync(out, 'utf8').trimEnd().split('\r\n');
    expect(lines).toHaveLength(2346);
    expect(lines[1]!.startsWith('1,')).toBe(true);
    expect(lines[2345]!.startsWith('2345,')).toBe(true);
    // Only the operator may read it (it names staff).
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const record = calls.find((c) => c.path.endsWith('/rpc/operator_log_audit_export'));
    expect(JSON.parse(record!.body)).toEqual({
      p_board_id: BOARD.id,
      p_last_id: 2345,
      p_rows: 2345,
    });
  });

  it('never writes over a file, and records nothing then', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lynx-audit-'));
    const out = path.join(dir, 'journal.csv');
    writeFileSync(out, 'keep me');
    const { values } = parseCli(['export-audit', '--board', 'csc-x', '--out', out]);
    const { db, calls } = fakeAuditApi(3);
    await expect(
      staffCommands['export-audit']!({ values, env: {} as AdminEnv, db }),
    ).rejects.toThrow(CliError);
    expect(readFileSync(out, 'utf8')).toBe('keep me');
    expect(calls.some((c) => c.path.endsWith('/rpc/operator_log_audit_export'))).toBe(false);
  });

  it('records an empty log as 0 entries', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lynx-audit-'));
    const { calls } = await exportAudit(['--board', 'csc-x', '--out', path.join(dir, 'a.csv')], 0);
    const record = calls.find((c) => c.path.endsWith('/rpc/operator_log_audit_export'));
    expect(JSON.parse(record!.body)).toMatchObject({ p_last_id: 0, p_rows: 0 });
  });
});

describe('auditExportCsv', () => {
  it('is UTF-8 with a byte order mark, one line per entry, the details as JSON', () => {
    const csv = auditExportCsv([
      entry(7, {
        action: 'operator.access',
        audience: 'board',
        category: 'access',
        actor_type: 'service',
        actor_user_id: null,
        actor_name: null,
        details: { reason: 'support' },
      }),
      entry(8, { school_name: 'É.É.C. Saint-Exemple, Ottawa', actor_name: '=HYPERLINK("x")' }),
    ]);
    const [header, first, second] = csv.slice(1).trimEnd().split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(header).toBe(
      'id,occurred_at,action,audience,category,school_id,school_name,actor_type,actor_user_id,actor_name,entity_type,entity_id,details',
    );
    expect(first).toBe(
      '7,2026-10-02T13:00:00+00:00,operator.access,board,access,,,service,,,staff_invitation,,"{""reason"":""support""}"',
    );
    // Commas quoted; a formula typed as a name stays text.
    expect(second).toContain(',"É.É.C. Saint-Exemple, Ottawa",');
    expect(second).toContain(`,"'=HYPERLINK(""x"")",`);
  });
});
