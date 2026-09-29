/**
 * Content packs, format v1 (DECISIONS D-099, D-100; slice S7): export a board's approved
 * resources to one JSON file, and import one into a board (staged, previewed as a dry run by
 * default, applied in one transaction with --apply; imported resources wait, private, in the
 * board's approval queue). Pack files hold answer keys: treat them as confidential.
 *
 *   pnpm admin export-pack --board csc-demo --slug lynx-fra-3e --version 2026.2 --title "…"
 *     --publisher "IP Lynx" --licence "…" [--no-derivatives] [--grade 3] [--subject fra]
 *     [--include-teacher-items] [--include-pack-items] [--allow-names "Marie,Joseph"] --out pack.json
 *   pnpm admin import-pack --board <slug> --file pack.json [--level-map debutant=debutant,…]
 *     [--apply] [--approve --approver <email>]
 *   pnpm admin list-packs --board <slug>
 */
import { notYetAvailable, type Command } from '../context';

export const packCommands: Record<string, Command> = {
  async 'export-pack'() {
    return notYetAvailable('export-pack');
  },
  async 'import-pack'() {
    return notYetAvailable('import-pack');
  },
  async 'list-packs'() {
    return notYetAvailable('list-packs');
  },
};
