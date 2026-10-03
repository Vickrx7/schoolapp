import type { AbsencePart, LocalDate } from '@lynx/domain';

/**
 * What a plan is shown with. None of it is stored in the plan JSON: it is read from tables
 * when the plan is displayed, so the plan never grants access to anything (D-048).
 */
export interface PlanContext {
  planId: string;
  planDate: LocalDate;
  part: AbsencePart;
  schoolName: string;
  timezone: string;
  officePhone: string | null;
  arrivalInstructions: string | null;
  emergencyInfo: string | null;
  /** « Mme Tremblay » */
  teacherName: string;
  absenceNote: string | null;
}

/** Active students of the covered classes: first names only (D-015). */
export interface RosterStudent {
  id: string;
  classId: string;
  firstName: string;
}

export interface PlanLevel {
  id: string;
  labelFr: string;
  labelEn: string | null;
  descriptionFr: string | null;
  sortOrder: number;
}
