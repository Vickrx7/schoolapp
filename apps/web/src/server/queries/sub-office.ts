import 'server-only';
import { notFound } from 'next/navigation';
import { addDays, nextInstructionalDays, type AbsencePart, type LocalDate } from '@lynx/domain';
import type { SubAccess } from '@/components/sub-codes/access-view';
import type { SchoolContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { loadSchoolEvents } from './absences';
import { loadSubAccess } from './sub-access';

/**
 * The « Suppléances » board for direction and office (DECISIONS D-056): who is away on a school
 * day, whether the plan is released, codes and devices, and whether the report arrived. Metadata
 * only: never plan or report contents (list_school_sub_days).
 */

export interface SubDayRow {
  absenceId: string;
  planId: string;
  planDate: LocalDate;
  part: AbsencePart;
  note: string | null;
  /** « Mme Tremblay » */
  teacherName: string;
  classNames: string[];
  roomNames: string[];
  released: boolean;
  /** released_at once released by hand, else the automatic release time. */
  releaseAt: string;
  releasedByName: string | null;
  /** The plan is being rebuilt after a change (D-047). */
  refreshing: boolean;
  activeCodes: number;
  devices: number;
  firstSessionAt: string | null;
  lastSeenAt: string | null;
  reportStatus: 'none' | 'in_progress' | 'submitted' | 'confirmed';
  /** Codes and devices, for cutting them one by one. Null if they could not be read. */
  access: SubAccess | null;
}

export interface SubBoardDay {
  date: LocalDate;
  rows: SubDayRow[];
}

/** How far ahead calendar events are read to find the next school day. */
const HORIZON_DAYS = 30;

/**
 * The board from `from`: that day if it is a school day, and the next school day (so « today »
 * on a Friday also shows Monday). `access: false` leaves out each plan's codes and devices (the
 * direction's dashboard shows their counts only).
 */
export async function loadSubBoard(
  school: SchoolContext,
  from: LocalDate,
  { access = true }: { access?: boolean } = {},
): Promise<SubBoardDay[]> {
  const supabase = await createSupabaseServerClient();
  const events = await loadSchoolEvents(supabase, school, from, addDays(from, HORIZON_DAYS));
  const days = nextInstructionalDays(from, 2, events);
  if (days.length === 0) return [];

  const { data, error } = await supabase.rpc('list_school_sub_days', {
    p_school_id: school.id,
    p_from: days[0]!,
    p_to: days[days.length - 1]!,
  });
  // The role that let this person read the school's days was removed since the page's session
  // was read (« Retirer ce rôle » in « Conseil »): « Page introuvable », as on the next visit.
  if (error?.code === '42501') notFound();
  if (error) throw new Error(`list_school_sub_days failed: ${error.code ?? ''}`);
  const rows = await Promise.all(
    (data ?? []).map(async (r): Promise<SubDayRow> => ({
      absenceId: r.absence_id,
      planId: r.plan_id,
      planDate: r.plan_date,
      part: r.part,
      note: r.note,
      teacherName: r.teacher_name,
      classNames: r.class_names ?? [],
      roomNames: r.room_names ?? [],
      released: r.released,
      releaseAt: r.release_at,
      releasedByName: r.released_by_name,
      refreshing: r.refreshing,
      activeCodes: r.active_codes,
      devices: r.devices,
      firstSessionAt: r.first_session_at,
      lastSeenAt: r.last_seen_at,
      reportStatus: (['in_progress', 'submitted', 'confirmed'] as const).includes(
        r.report_status as 'in_progress',
      )
        ? (r.report_status as SubDayRow['reportStatus'])
        : 'none',
      access: access ? await loadSubAccess(supabase, r.plan_id) : null,
    })),
  );
  return days.map((date) => ({ date, rows: rows.filter((r) => r.planDate === date) }));
}
