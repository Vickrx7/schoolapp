/**
 * « Couverture du curriculum » for the operator (DECISIONS D-094; slice S5): the attentes of a
 * grade and subject with no or few board-approved resources, from the same database function as
 * the app's page (`public.library_coverage`, which the service role may call).
 *
 *   pnpm admin coverage --board csc-demo --grade 3 --subject mat [--min 2] [--csv]
 */
import { notYetAvailable, type Command } from '../context';

export const coverageCommands: Record<string, Command> = {
  async coverage() {
    return notYetAvailable('coverage');
  },
};
