/**
 * What the code panel shows around a plan's codes: enough for the welcome sheet and the text
 * or email the issuer sends from her own phone. Names appear on paper only, never in a message.
 */
export interface SubCodeContext {
  planId: string;
  planDate: string;
  timezone: string;
  schoolName: string;
  /** For messages (« É.É.C. Saint-Exemple »); the full name when there is none. */
  schoolShortName: string | null;
  /** « Mme Tremblay » (welcome sheet only). */
  teacherName: string;
  classNames: string[];
  roomNames: string[];
  officePhone: string | null;
  arrivalInstructions: string | null;
}

/** A code just generated: shown once, then forgotten when the dialog closes. */
export interface ShownCode {
  code: string;
  validFrom: string;
  expiresAt: string;
  baseUrl: string;
}
