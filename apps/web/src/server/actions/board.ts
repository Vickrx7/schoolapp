'use server';

import {
  schoolYearFormSchema,
  staffInviteFormSchema,
  staffRoleFormSchema,
  type StaffRole,
} from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { adminBoards, requireSession } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { parseInput } from './validation';

/**
 * « Conseil » (DECISIONS D-107, D-108): a board admin manages the staff of their own board, its
 * school years, its library reviewers and the feedback it received. The database decides who may
 * do what (board admins of that board, no self-grants, never the last admin or a person's last
 * role, nobody who also works elsewhere); people are named by one of their roles in the board,
 * never by a user id. Every function here is a public endpoint: each validates its arguments.
 */

const uuid = z.uuid();

/** Session-level data (roles, schools) may change: every page and the navigation refresh. */
function refreshAll() {
  revalidatePath('/', 'layout');
}

export type InviteStaffInput = z.input<typeof staffInviteFormSchema>;

export interface InviteStaffResult {
  invitationId: string;
  status: 'pending' | 'ready' | 'failed';
  errorCode: string | null;
}

/**
 * « Inviter une personne »: a pending invitation the worker turns into an account, the role at
 * once for an active colleague of the board, or a failure the page explains (`emailConflict`).
 */
export async function inviteStaff(
  input: InviteStaffInput,
): Promise<ActionResult<InviteStaffResult>> {
  const session = await requireSession();
  const parsed = parseInput(staffInviteFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  if (!adminBoards(session).some((b) => b.id === v.boardId)) return fail('forbidden');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('invite_staff', {
    p_board_id: v.boardId,
    p_school_id: v.schoolId as string,
    p_email: v.email,
    p_display_name: v.displayName,
    p_honorific: v.honorific as string,
    p_role: v.role,
  });
  if (error) {
    // A pending invitation for the same address, role and school.
    return fail(error.code === '23505' ? 'staffAlreadyInvited' : reportError('inviteStaff', error));
  }
  const row = data?.[0];
  if (!row) return fail('unexpected');
  revalidatePath('/board', 'layout');
  return ok({
    invitationId: row.invitation_id,
    status: row.status as InviteStaffResult['status'],
    errorCode: row.error_code,
  });
}

/** For « Préparation du compte… » (polled while the worker creates the account). */
export async function invitationStatus(
  invitationId: string,
): Promise<ActionResult<{ status: string; errorCode: string | null }>> {
  if (!uuid.safeParse(invitationId).success) return fail('invalid');
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('staff_invitations')
    .select('status, error_code')
    .eq('id', invitationId)
    .maybeSingle();
  if (error) return fail(reportError('invitationStatus', error));
  if (!data) return fail('notFound');
  return ok({ status: data.status, errorCode: data.error_code });
}

/** « Annuler l'invitation », while it is being prepared. */
export async function cancelInvitation(invitationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invitationId).success) return fail('invalid');
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('cancel_staff_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) return fail(reportError('cancelInvitation', error));
  revalidatePath('/board', 'layout');
  return okVoid();
}

export type GrantRoleInput = z.input<typeof staffRoleFormSchema>;

/** « Ajouter un rôle » to the person who holds `roleId` in the board. */
export async function grantRole(roleId: string, input: GrantRoleInput): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success) return fail('invalid');
  const parsed = parseInput(staffRoleFormSchema, input);
  if (!parsed.ok) return parsed.result;
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('grant_staff_role', {
    p_role_id: roleId,
    p_role: parsed.data.role satisfies StaffRole,
    p_school_id: parsed.data.schoolId as string,
  });
  if (error) return fail(reportError('grantRole', error));
  refreshAll();
  return okVoid();
}

/** « Retirer ce rôle » (never a person's last role, LXU08; never the last admin, LXU01). */
export async function revokeRole(roleId: string): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success) return fail('invalid');
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_staff_role', { p_role_id: roleId });
  if (error) return fail(reportError('revokeRole', error));
  refreshAll();
  return okVoid();
}

/**
 * « Retirer l'accès » / « Rétablir l'accès » of the person who holds `roleId`: the database
 * refuses or changes the profile at once; the worker then bans or unbans the sign-in.
 */
export async function setStaffActive(roleId: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success || typeof active !== 'boolean') return fail('invalid');
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_staff_active', {
    p_role_id: roleId,
    p_active: active,
  });
  if (error) return fail(reportError('setStaffActive', error));
  refreshAll();
  return okVoid();
}

export type SchoolYearInput = z.input<typeof schoolYearFormSchema>;

/** Adds (`yearId` null) or changes a school year of the board (row level security: its admins). */
export async function saveSchoolYear(
  boardId: string,
  yearId: string | null,
  input: SchoolYearInput,
): Promise<ActionResult> {
  if (!uuid.safeParse(boardId).success) return fail('invalid');
  if (yearId !== null && !uuid.safeParse(yearId).success) return fail('invalid');
  const parsed = parseInput(schoolYearFormSchema, input);
  if (!parsed.ok) return parsed.result;
  const session = await requireSession();
  if (!adminBoards(session).some((b) => b.id === boardId)) return fail('forbidden');
  const row = {
    name: parsed.data.name,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = yearId
    ? await supabase
        .from('school_years')
        .update(row)
        .eq('id', yearId)
        .eq('board_id', boardId)
        .select('id')
    : await supabase
        .from('school_years')
        .insert({ ...row, board_id: boardId })
        .select('id');
  if (error) return fail(reportError('saveSchoolYear', error));
  if (!data?.length) return fail('forbidden');
  refreshAll();
  return okVoid();
}

/** Refused while classes use the year (23503: `inUse`). */
export async function deleteSchoolYear(yearId: string): Promise<ActionResult> {
  if (!uuid.safeParse(yearId).success) return fail('invalid');
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('school_years')
    .delete()
    .eq('id', yearId)
    .select('id');
  if (error) return fail(reportError('deleteSchoolYear', error));
  if (!data?.length) return fail('forbidden');
  refreshAll();
  return okVoid();
}

const reviewerSchema = z.object({ approvesContent: z.boolean(), reviewsFaith: z.boolean() });

/**
 * Designates, changes or (both false) removes the board's library reviewer who holds `roleId`
 * (amends D-064: the board's admins do it in the web).
 */
export async function setLibraryReviewer(
  roleId: string,
  input: z.input<typeof reviewerSchema>,
): Promise<ActionResult> {
  if (!uuid.safeParse(roleId).success) return fail('invalid');
  const parsed = parseInput(reviewerSchema, input);
  if (!parsed.ok) return parsed.result;
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_library_reviewer', {
    p_role_id: roleId,
    p_approves_content: parsed.data.approvesContent,
    p_reviews_faith: parsed.data.reviewsFaith,
  });
  if (error) return fail(reportError('setLibraryReviewer', error));
  refreshAll();
  return okVoid();
}

const feedbackStatus = z.enum(['new', 'read', 'done']);

/** « Nouveau », « Lu », « Traité » (row level security: the board's admins). */
export async function setFeedbackStatus(
  feedbackId: string,
  status: z.input<typeof feedbackStatus>,
): Promise<ActionResult> {
  if (!uuid.safeParse(feedbackId).success || !feedbackStatus.safeParse(status).success) {
    return fail('invalid');
  }
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('feedback')
    .update({ status })
    .eq('id', feedbackId)
    .select('id');
  if (error) return fail(reportError('setFeedbackStatus', error));
  if (!data?.length) return fail('forbidden');
  revalidatePath('/board/feedback');
  return okVoid();
}
