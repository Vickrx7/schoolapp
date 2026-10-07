import type { LocalDate, LocalTime } from '@lynx/domain';

/** The cookie that remembers the « Ajouter un moment de foi » switch on this device. */
export const FAITH_COOKIE = 'lynx_absence_faith';

/** What the absence form needs per school to offer its date chips. */
export interface AbsenceFormSchool {
  id: string;
  name: string;
  timezone: string;
  today: LocalDate;
  /** « Aujourd'hui » is offered only on a school day before dismissal. */
  todayOpen: boolean;
  nextSchoolDay: LocalDate;
  /** Today before dismissal, otherwise the next school day. */
  defaultDate: LocalDate;
  /** The school's half-day split setting (the plan's own split is shown when known). */
  halfDaySplit: LocalTime | null;
}
