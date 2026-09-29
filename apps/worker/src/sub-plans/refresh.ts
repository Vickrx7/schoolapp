/**
 * Keeps substitute plans up to date after publishing (DECISIONS D-047).
 *
 * The web server builds an absence's plans in the publish request. Afterwards, a change to
 * anything they were built from (a lesson checked off, the timetable, the calendar, the roster,
 * the « Fiche de suppléance ») marks the absence (absences.sources_changed_at) and emits
 * absence.sources_changed once. This rebuilds the plans with the same loader
 * (app.sub_plan_sources) and the same builder (buildAbsencePlans) as the web server, then saves
 * them with compare-and-set: a change made while building moves the mark, the save is refused,
 * and the build starts again from fresh sources.
 *
 * app.write_absence_plans decides what may still change: a day a substitute has opened, or one
 * released on its own date, is kept as it is, and the later days continue after it.
 *
 * Library resources for the open lessons (app.sub_plan_library_sources, D-077) are read next to
 * the sources and merged in as `library`, as the web server does.
 *
 * Logs hold ids, dates and counts only: never plan text or names.
 */
import {
  buildAbsencePlans,
  subPlanSourcesSchema,
  type AbsencePart,
  type SubPlanSources,
} from '@lynx/domain';
import type { Pool } from 'pg';
import type { Logger } from '../logger';

/** Only `query` is used, so a client inside a transaction works too (tests). */
type Db = Pick<Pool, 'query'>;

/**
 * Builds per run before giving up. The run then fails, and graphile-worker retries the job with
 * a growing delay, so a burst of edits (a teacher reworking her unit) is waited out.
 */
export const REFRESH_ATTEMPTS = 3;

export type RefreshOutcome =
  /** New plans were saved (days that can no longer change were left as they were). */
  | 'refreshed'
  /** Nothing to do: the absence is gone, no longer published, or not marked. */
  | 'up_to_date';

interface AbsenceRow {
  teacher_id: string;
  school_id: string;
  starts_on: string;
  ends_on: string;
  part: AbsencePart;
  catholic_connection: boolean;
  status: string;
  /** Read as text: the save compares it to the microsecond, and a JS Date drops microseconds. */
  sources_changed_at: string | null;
}

async function readAbsence(db: Db, absenceId: string): Promise<AbsenceRow | null> {
  const { rows } = await db.query<AbsenceRow>(
    `select teacher_id, school_id,
            to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
            part, catholic_connection, status::text as status,
            sources_changed_at::text as sources_changed_at
       from public.absences where id = $1`,
    [absenceId],
  );
  return rows[0] ?? null;
}

/** The library loader's result merged into the sources (read leniently by the schema). */
function withLibrary(sources: unknown, library: unknown): unknown {
  return sources && typeof sources === 'object' && !Array.isArray(sources)
    ? { ...sources, library }
    : sources;
}

/** The loader's JSON, checked. A failure names paths only (no values reach the logs). */
function parseSources(raw: unknown): SubPlanSources {
  const parsed = subPlanSourcesSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
  throw new Error(`plan sources did not parse at ${paths.slice(0, 5).join(', ')}`);
}

/**
 * Rebuilds the plans of one absence if it is marked as out of date. Safe to run more than once:
 * a run that finds the mark cleared does nothing, unless `force` says the event came from the
 * teacher's earlier absence, whose lessons this one continues (app.write_absence_plans wakes
 * the next absence without marking it, so it never locks a second absence).
 *
 * Throws when the sources kept changing for REFRESH_ATTEMPTS builds in a row (the job is then
 * retried later), and on database or loader errors. A day whose build throws gets the minimal
 * plan instead (buildAbsencePlans), so one bad day never blocks the others.
 */
export async function refreshAbsencePlans(
  absenceId: string,
  deps: { pool: Db; logger: Logger; now?: () => Date; force?: boolean },
): Promise<RefreshOutcome> {
  const { pool, logger } = deps;
  const now = deps.now ?? (() => new Date());

  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    const absence = await readAbsence(pool, absenceId);
    if (!absence || absence.status !== 'published') return 'up_to_date';
    // Not marked: nothing changed since the last build, unless the earlier absence did.
    if (absence.sources_changed_at === null && !(deps.force && attempt === 1)) {
      return 'up_to_date';
    }

    const loaded = await pool.query<{ sources: unknown }>(
      'select app.sub_plan_sources($1, $2, $3::date, $4::date, $5) as sources',
      [absence.teacher_id, absence.school_id, absence.starts_on, absence.ends_on, absenceId],
    );
    const library = await pool.query<{ library: unknown }>(
      'select app.sub_plan_library_sources($1, $2) as library',
      [absence.teacher_id, absence.school_id],
    );
    const sources = parseSources(withLibrary(loaded.rows[0]?.sources, library.rows[0]?.library));
    const { plans } = buildAbsencePlans(
      sources,
      {
        startsOn: absence.starts_on,
        endsOn: absence.ends_on,
        part: absence.part,
        catholicConnection: absence.catholic_connection,
      },
      {
        now: now(),
        onError: (date, error) =>
          logger.warn('sub plan day fell back to the minimal plan', {
            absenceId,
            date,
            error: error instanceof Error ? error.name : 'unknown',
          }),
      },
    );

    // Refused (false) when the mark moved since it was read: the sources are stale.
    const saved = await pool.query<{ written: boolean }>(
      'select app.write_absence_plans($1, $2::jsonb, $3::timestamptz, true) as written',
      [absenceId, JSON.stringify(plans), absence.sources_changed_at],
    );
    if (saved.rows[0]?.written) {
      logger.info('sub plans refreshed', { absenceId, days: plans.length, attempt });
      return 'refreshed';
    }
  }

  logger.warn('sub plans kept changing while being rebuilt', { absenceId });
  throw new Error(`absence plans kept changing during ${REFRESH_ATTEMPTS} builds; retrying later`);
}
