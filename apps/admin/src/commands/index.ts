/**
 * Every admin command, by name. Each group lives in its own module (Phase 5 slices own
 * coverage.ts, bulk.ts and packs.ts; Phase 6 slices ops.ts and staff.ts); a name may appear in
 * one module only.
 */
import type { Command } from '../context';
import { aiCommands } from './ai';
import { bulkCommands } from './bulk';
import { coverageCommands } from './coverage';
import { libraryCommands } from './library';
import { opsCommands } from './ops';
import { packCommands } from './packs';
import { setupCommands } from './setup';
import { staffCommands } from './staff';

export const COMMAND_GROUPS: readonly Readonly<Record<string, Command>>[] = [
  setupCommands,
  aiCommands,
  libraryCommands,
  coverageCommands,
  bulkCommands,
  packCommands,
  staffCommands,
  opsCommands,
];

export const commands: Readonly<Record<string, Command>> = Object.assign(
  {},
  ...COMMAND_GROUPS,
) as Record<string, Command>;
