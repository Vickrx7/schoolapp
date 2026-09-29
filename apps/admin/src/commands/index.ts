/**
 * Every admin command, by name. Each group lives in its own module (Phase 5 slices own
 * coverage.ts, bulk.ts and packs.ts); a name may appear in one module only.
 */
import type { Command } from '../context';
import { aiCommands } from './ai';
import { bulkCommands } from './bulk';
import { coverageCommands } from './coverage';
import { libraryCommands } from './library';
import { packCommands } from './packs';
import { setupCommands } from './setup';

export const COMMAND_GROUPS: readonly Readonly<Record<string, Command>>[] = [
  setupCommands,
  aiCommands,
  libraryCommands,
  coverageCommands,
  bulkCommands,
  packCommands,
];

export const commands: Readonly<Record<string, Command>> = Object.assign(
  {},
  ...COMMAND_GROUPS,
) as Record<string, Command>;
