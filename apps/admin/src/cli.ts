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
 *
 * Catholic references of a board (see DECISIONS.md, D-147; docs/catholic-references.md). A dry
 * run unless --apply; each reference is matched by type and title, created or updated, and the
 * board's other references are kept. content/catholic-references/sample.json is an example
 * (fictional, to check):
 *   pnpm admin import-references --board csc-exemple --file content/catholic-references/sample.json [--apply]
 *
 * Library growth (Phase 5; each command's usage is at the top of its module): the coverage
 * report (commands/coverage.ts), bulk generation (commands/bulk.ts) and content packs
 * (commands/packs.ts).
 *
 * Pilot operations (Phase 6; usage at the top of each module): recording a support access before
 * reading a board's data, deleting an account or a board on request (commands/staff.ts), the
 * board's retention settings and the operator's status (commands/ops.ts).
 *
 * Settings: SUPABASE_URL (or the older NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY,
 * from apps/web/.env.local when it exists. OPERATOR_NAME (IP Lynx by default; 1 to 80 characters)
 * is who the board's audit log names for each entry a command writes (DECISIONS D-148): on a
 * board's own servers, its IT. An invalid one stops any command before it starts.
 *
 * The commands live in commands/ (one module per group, registered in commands/index.ts); the
 * options in args.ts; the database client and shared helpers in context.ts.
 */
import { EnvError, operatorNameFrom } from '@lynx/config';
import { z } from 'zod';
import { parseCli, type CliValues } from './args';
import { commands } from './commands';
import { CliError, createContext } from './context';

function usage(): string {
  return `Usage: pnpm admin <${Object.keys(commands).join('|')}> [options]\nSee apps/admin/src/cli.ts for examples.`;
}

let parsed: { command: string | undefined; values: CliValues };
try {
  parsed = parseCli(process.argv.slice(2));
} catch (err) {
  // An unknown option or a missing value: nothing has run.
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n${usage()}`);
  process.exit(1);
}

const run = parsed.command ? commands[parsed.command] : undefined;
if (!run) {
  console.error(usage());
  process.exit(1);
}
try {
  // The name every entry of this command will carry: checked before anything runs (D-148).
  operatorNameFrom(process.env);
  console.log(await run(createContext(parsed.values)));
} catch (err) {
  if (err instanceof z.ZodError)
    console.error(`Error: ${err.issues.map((i) => i.message).join('; ')}`);
  else if (err instanceof CliError || err instanceof EnvError)
    console.error(`Error: ${err.message}`);
  else console.error(err);
  process.exit(1);
}
