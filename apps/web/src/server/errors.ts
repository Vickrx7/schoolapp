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
