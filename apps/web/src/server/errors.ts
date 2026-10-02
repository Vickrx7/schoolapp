import 'server-only';
import { scrubText } from '@lynx/observability';
import { webLogger } from './observability';

interface PgLikeError {
  code?: string;
  message?: string;
  /** PostgREST's name for the error's DETAIL (`LXL01` names what is missing there). */
  details?: string | null;
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
    // Hardening (supabase/migrations/20261003100000_substitute_hardening.sql).
    case 'LXS16':
      return 'subReportChanged';
    case 'LXS23':
      return 'absenceRequestReused';
    case 'LXS20':
      return 'absencePast';
    case 'LXS21':
      return 'absenceTooLong';
    case 'LXS22':
      return 'absenceOverlap';
    // Library (supabase/migrations/20261015090000_library_core.sql; LXL08 and LXL09 come
    // with the library AI functions).
    case 'LXL01':
      return 'libraryNotReady';
    case 'LXL02':
      return 'librarySafetyNotes';
    case 'LXL03':
      return 'libraryFaithReviewNeeded';
    case 'LXL04':
      return 'libraryWrongStatus';
    case 'LXL05':
      return 'libraryOwnItem';
    case 'LXL06':
      return 'libraryLocked';
    case 'LXL07':
      return 'libraryConflict';
    case 'LXL08':
      return 'libraryTooLargeForAi';
    case 'LXL09':
      return 'libraryLevelExists';
    case 'LXL10':
      return 'libraryPersonalLevels';
    // Class mode (Phase 5, DECISIONS D-082 to D-090; raised by the class-mode functions).
    case 'LXC01':
      return 'classSessionOpen';
    case 'LXC02':
      return 'classSessionChanged';
    case 'LXC03':
      return 'classSessionNoMore';
    case 'LXC04':
      return 'classModeNotPlayable';
    case 'LXC05':
      return 'classSessionEnded';
    // Adaptations (D-092): LXM03 comes from a trigger, so every sharing path can raise it.
    case 'LXM01':
      return 'libraryRemixArchived';
    case 'LXM02':
      return 'libraryRemixLicence';
    case 'LXM03':
      return 'libraryShareCap';
    // Opinions (D-093).
    case 'LXR01':
      return 'libraryRateOwn';
    case 'LXR02':
      return 'libraryRateNotApproved';
    // Phase 6: staff accounts and roles (DECISIONS D-107), onboarding (D-109), feedback (D-116).
    case 'LXU01':
      return 'lastBoardAdmin';
    case 'LXU02':
      return 'staffOtherBoard';
    case 'LXU05':
      return 'staffSelf';
    case 'LXU06':
      return 'staffStillActive';
    case 'LXU07':
      return 'staffSelfRole';
    case 'LXU08':
      return 'staffLastRole';
    case 'LXO01':
      return 'noSchoolYear';
    case 'LXF01':
      return 'feedbackLimit';
    default:
      return 'unexpected';
  }
}

/** What `app.library_assert_ready` names in the detail of `LXL01` (DECISIONS D-067). */
export const READINESS_CODES = [
  'grades',
  'subject',
  'duration',
  'materials',
  'tags',
  'base',
  'expectations',
  'key',
  'levels',
] as const;
export type ReadinessCode = (typeof READINESS_CODES)[number];

/**
 * The field errors of a « not ready » refusal (`LXL01`): `{ 'readiness.<code>':
 * 'readiness.<code>' }`, where the value is the message key (`errors.readiness.<code>`) and the
 * field is the readiness checklist's line. Undefined for any other error, or a detail the app
 * does not know (then the action's error key is enough).
 */
export function readinessFieldErrors(
  error: PgLikeError | null | undefined,
): Record<string, string> | undefined {
  if (error?.code !== 'LXL01') return undefined;
  const code = (error.details ?? '').trim();
  if (!(READINESS_CODES as readonly string[]).includes(code)) return undefined;
  return { [`readiness.${code}`]: `readiness.${code}` };
}

/**
 * Logs unexpected errors server-side and returns the error key. The line holds the context, the
 * error's code and its scrubbed message (DECISIONS D-111): never a value Postgres echoed back, a
 * quoted name or an e-mail.
 */
export function reportError(context: string, error: PgLikeError | null | undefined): string {
  const key = errorKey(error);
  if (key === 'unexpected') {
    webLogger.error('unexpected', {
      context,
      error: {
        code: typeof error?.code === 'string' ? error.code.slice(0, 12) : null,
        message: scrubText(error?.message ?? ''),
      },
    });
  }
  return key;
}
