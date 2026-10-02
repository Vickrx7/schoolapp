import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext } from '../context';
import {
  deletedAccountSummary,
  deletedBoardSummary,
  parseReason,
  staffCommands,
  staffErrorMessage,
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
    ).toMatch(/audit log.*export-pack.*--exported/);
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
        },
        2,
      ),
    ).toBe(
      'Deleted CSC Exemple: 2 school(s), 5 class(es), 9 resource(s), 2 person(s) who worked there only (2 sign-in account(s) deleted), 120 audit row(s). People who also work in another board keep their account there.',
    );
  });
});
