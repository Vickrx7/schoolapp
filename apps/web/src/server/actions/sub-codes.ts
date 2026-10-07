'use server';

import { formatAccessCode, generateAccessCode } from '@lynx/domain';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SubAccess } from '@/components/sub-codes/access-view';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { serverEnv } from '../env';
import { reportError } from '../errors';
import { loadSubAccess } from '../queries/sub-access';
import { requireSession } from '../session';
import { codeMac } from '../sub-portal/crypto';
import { subPortalConfigured } from '../sub-portal/db';
import { subCodeKeys } from '../sub-portal/keys';
import { createSupabaseServerClient } from '../supabase';

// Substitute codes for staff (DECISIONS D-050, D-056): the absent teacher, direction and office
// issue and cut codes and devices. The database checks who may (app.sub_plan_role) and audits
// every change; it only ever receives a code's keyed MAC.

const id = z.uuid();

export interface IssuedSubCode {
  codeId: string;
  /** « 7KQ4M-9TDXA »: shown once, to the person who generated it. */
  code: string;
  validFrom: string;
  expiresAt: string;
  /** The app's address, for « …/suppleance#code=… » and the short « …/s ». */
  baseUrl: string;
}

function refresh() {
  revalidatePath('/absences', 'layout');
}

/**
 * « Générer un code »: a new code for one plan (at most two active per plan). The code exists
 * in plain text only in this response; nobody can look it up later, so « Générer un code »
 * always makes a new one.
 */
export async function issueSubCode(planId: string): Promise<ActionResult<IssuedSubCode>> {
  await requireSession();
  if (!id.safeParse(planId).success) return fail('invalid');
  if (!subPortalConfigured()) return fail('subPortalNotConfigured');
  const keys = subCodeKeys();
  if (!keys) return fail('subCodesKeyMissing');

  const supabase = await createSupabaseServerClient();
  // A new code colliding with a stored one (2^-50) is retried once rather than reported.
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = generateAccessCode((n) => randomBytes(n));
    const { data, error } = await supabase.rpc('issue_sub_access_code', {
      p_plan_id: planId,
      p_code_mac: codeMac(code, keys),
    });
    if (error?.code === '23505' && attempt === 0) continue;
    if (error) return fail(reportError('issueSubCode', error));
    const row = data?.[0];
    if (!row) return fail('unexpected');
    refresh();
    return ok({
      codeId: row.code_id,
      code: formatAccessCode(code),
      validFrom: row.valid_from,
      expiresAt: row.expires_at,
      baseUrl: serverEnv().APP_BASE_URL.replace(/\/+$/, ''),
    });
  }
  return fail('unexpected');
}

/** « Couper » a code: the devices signed in with it lose access at their next request. */
export async function revokeSubCode(codeId: string): Promise<ActionResult> {
  await requireSession();
  if (!id.safeParse(codeId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_sub_access_code', { p_code_id: codeId });
  if (error) return fail(reportError('revokeSubCode', error));
  refresh();
  return okVoid();
}

/** « Couper » one device: it cannot sign in again with the same code. */
export async function revokeSubSession(sessionId: string): Promise<ActionResult> {
  await requireSession();
  if (!id.safeParse(sessionId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_sub_session', { p_session_id: sessionId });
  if (error) return fail(reportError('revokeSubSession', error));
  refresh();
  return okVoid();
}

/** « Couper tout l'accès »: every code and device of the plan. */
export async function revokeAllSubAccess(planId: string): Promise<ActionResult> {
  await requireSession();
  if (!id.safeParse(planId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_sub_plan_access', { p_plan_id: planId });
  if (error) return fail(reportError('revokeAllSubAccess', error));
  refresh();
  return okVoid();
}

/** The plan's codes and devices (metadata only), for panels that refresh themselves. */
export async function listSubAccess(planId: string): Promise<ActionResult<SubAccess>> {
  await requireSession();
  if (!id.safeParse(planId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const access = await loadSubAccess(supabase, planId);
  return access ? ok(access) : fail('forbidden');
}
