/**
 * What the absence form's chips stand for: the dates and part of day that « Envoyer » sends.
 * Pure, so the rules are unit-tested: « Aujourd'hui » only on a school day before dismissal, a
 * date in the past is never sent, a half day is a single day, at most 14 days.
 */
import {
  ABSENCE_MAX_DAYS,
  daysBetween,
  isLocalDate,
  type AbsencePart,
  type LocalDate,
} from '@lynx/domain';
import type { AbsenceFormSchool } from './types';

export type DateChoice = 'today' | 'next' | 'other';

export interface DateFields {
  choice: DateChoice;
  /** The « Autre date » field. */
  otherDate: string;
  several: boolean;
  /** The « Dernier jour » field (used with « Plusieurs jours »). */
  endsOn: string;
  part: AbsencePart;
}

type School = Pick<AbsenceFormSchool, 'today' | 'todayOpen' | 'nextSchoolDay' | 'defaultDate'>;

/** The chip preselected for a school: today before dismissal, otherwise the next school day. */
export function initialChoice(school: School): DateChoice {
  return school.todayOpen && school.defaultDate === school.today ? 'today' : 'next';
}

export function absenceDates(
  fields: DateFields,
  school: School,
): { startsOn: LocalDate | ''; endsOn: LocalDate | ''; part: AbsencePart; valid: boolean } {
  // A draft restored on a later day may say « today » after dismissal: the next school day then.
  const startsOn =
    fields.choice === 'today' && school.todayOpen
      ? school.today
      : fields.choice === 'other'
        ? isLocalDate(fields.otherDate) && fields.otherDate >= school.today
          ? fields.otherDate
          : ''
        : school.nextSchoolDay;
  const endsOn =
    fields.several && isLocalDate(fields.endsOn) && startsOn !== '' ? fields.endsOn : startsOn;
  const part: AbsencePart = endsOn === startsOn ? fields.part : 'full_day';
  const valid =
    startsOn !== '' &&
    endsOn !== '' &&
    endsOn >= startsOn &&
    daysBetween(startsOn, endsOn) < ABSENCE_MAX_DAYS;
  return { startsOn, endsOn, part, valid };
}
