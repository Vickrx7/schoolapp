/**
 * The class tab « Mode classe » (DECISIONS D-084, D-089): `public.class_mode_overview` gives the
 * open session (possibly a colleague's), the kept results, whether the class has a link, and the
 * board's retention for kept results. Parsed here (the function returns JSON); unknown keys are
 * dropped. Pure so it is unit-tested.
 */
import { z } from 'zod';

const orNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
const timestamp = z.string().min(1).max(64);

export const classModeOverviewSchema = z.object({
  open: orNull(
    z.object({
      id: z.uuid(),
      itemId: orNull(z.uuid()),
      itemTitle: orNull(z.string().max(200)),
      phase: z.enum(['lobby', 'question', 'reveal', 'leaderboard', 'finished']),
      mode: z.enum(['teams', 'solo']),
      startedAt: timestamp,
      expiresAt: timestamp,
      /** « Mme Tremblay »: who started it (null when that account is gone). */
      startedByName: orNull(z.string().max(200)),
      /** The signed-in teacher started it. */
      mine: z.boolean(),
    }),
  ),
  results: z
    .array(
      z.object({
        sessionId: z.uuid(),
        itemTitle: orNull(z.string().max(200)),
        mode: z.enum(['teams', 'solo']),
        savedAt: timestamp,
        participantCount: z.number().int().min(0),
        questionsPlayed: z.number().int().min(0),
      }),
    )
    .max(50),
  hasLink: z.boolean(),
  library: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
});
export type ClassModeOverview = z.output<typeof classModeOverviewSchema>;
