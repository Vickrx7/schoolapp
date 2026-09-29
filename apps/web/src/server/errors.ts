import 'server-only';

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Maps a Postgres/PostgREST error to a translation key under `errors`. */
export function errorKey(error: PgLikeError | null | undefined): string {
  switch (error?.code) {
    case '42501':
      return 'forbidden';
    case '23505':
      return 'duplicate';
    case '23503':
      return 'inUse';
    case '22023':
    case '23514':
    case '22P02':
      return 'invalid';
    case '55000':
      return 'featureDisabled';
    case 'P0002':
    case 'PGRST116':
      return 'notFound';
    // Substitute hand-off (supabase/migrations/20261001100200_substitute_plans.sql).
    case 'LXS10':
      return 'subPlanConflict';
    case 'LXS12':
      return 'subPlanInUse';
    case 'LXS13':
      return 'subCodeLimit';
    case 'LXS14':
      return 'subDayOver';
    // « Consignes détaillées » (supabase/migrations/20261002100000_sub_plan_ai.sql).
    case 'LXS15':
      return 'subPlanAiStale';
    case 'LXS20':
      return 'absencePast';
    case 'LXS21':
      return 'absenceTooLong';
    case 'LXS22':
      return 'absenceOverlap';
    default:
      return 'unexpected';
  }
}

/** Logs unexpected errors server-side (never student data) and returns the error key. */
export function reportError(context: string, error: PgLikeError | null | undefined): string {
  const key = errorKey(error);
  if (key === 'unexpected') {
    console.error(
      JSON.stringify({ level: 'error', context, code: error?.code, message: error?.message }),
    );
  }
  return key;
}
