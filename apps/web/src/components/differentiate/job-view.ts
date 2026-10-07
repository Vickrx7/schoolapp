/** Shaping stored requests for display. */
import type { DifferentiateInput, DifferentiateOutput } from '@lynx/ai/features/differentiate';
import { formatDateWith } from '../../lib/format';
import type { EditorVersion } from './result-lines';

/**
 * The editor's versions for a finished request, in the requested order. Level names follow the
 * interface language (D-033): `labels` maps level ids to their localized names, and the French
 * name stored with the request is the fallback (for a level deleted since).
 */
export function jobEditorVersions(
  input: Pick<DifferentiateInput, 'levels'>,
  result: Pick<DifferentiateOutput, 'versions'>,
  labels: ReadonlyMap<string, string>,
): EditorVersion[] {
  const byKey = new Map(input.levels.map((l) => [l.key, l]));
  return result.versions.flatMap((v) => {
    const level = byKey.get(v.level);
    return level
      ? [
          {
            languageLevelId: level.languageLevelId,
            levelLabel: labels.get(level.languageLevelId) ?? level.label,
            title: v.title,
            text: v.text,
            glossary: v.glossary,
            visualSupports: v.visualSupports,
            questions: v.questions,
            teacherNote: v.teacherNote,
          },
        ]
      : [];
  });
}

export const DEFAULT_TIME_ZONE = 'America/Toronto';

/**
 * A moment (ISO timestamp) as a date and time in the school's time zone, never the server's:
 * « 28 sept. 2026, 15 h 45 ».
 */
export function formatMoment(iso: string, locale: string, timeZone = DEFAULT_TIME_ZONE): string {
  return formatDateWith(
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }),
    new Date(iso),
    locale,
  );
}
