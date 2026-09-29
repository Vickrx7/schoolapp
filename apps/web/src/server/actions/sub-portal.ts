'use server';

import type { AlertCategory } from '@lynx/db';
import { normalizeAccessCode, subReportContentSchema, subReportNotesSchema } from '@lynx/domain';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isLocale } from '@/i18n/config';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { decryptAlert, parseKeyRing } from '../alerts-crypto';
import { serverEnv } from '../env';
import { reportError } from '../errors';
import { writeLocaleCookie } from '../locale';
import { clientIp } from '../sub-portal/client-ip';
import { codeMacs, deviceKey, ipKey } from '../sub-portal/crypto';
import { subPortalConfigured } from '../sub-portal/db';
import { subCodeKeys } from '../sub-portal/keys';
import {
  endPortalSession,
  loadDay,
  portalAlerts,
  redeemCode,
  saveReport,
} from '../sub-portal/portal';
import {
  clearSubSessionCookie,
  readSubToken,
  setSubSessionCookie,
  subDeviceId,
} from '../sub-portal/session';
import { encryptReportNotes, hasReportNotes } from '../sub-reports/notes';
import { parseInput } from './validation';

// The substitute portal's actions (DECISIONS D-049 to D-051). Substitutes have no account: these
// never read a staff session and reach the database only through the portal role. Outcomes a
// substitute can act on are results, not errors; errors are for this server's configuration or
// an unexpected failure.

/** What « Commencer » answers when the device is not signed in (it is redirected otherwise). */
export type RedeemState =
  | null
  | { outcome: 'invalid' | 'used_up' | 'revoked' }
  | { outcome: 'wait'; retryAfter: number }
  /** A translation key under `errors` (this server's configuration, an unexpected failure). */
  | { error: string };

/** Longest input looked at: a code with generous spacing. */
const MAX_INPUT = 40;

/**
 * « Commencer »: signs this device in with the code typed, then opens the plan. A form action,
 * so it also works before the page is interactive (the code is posted, never put in the
 * address). The code is normalized first (lowercase, spaces, hyphens, O for 0, I or L for 1);
 * anything else is refused here without a database call. Throttling is per device (its cookie)
 * and per network (CLIENT_IP_HEADER).
 */
export async function redeemSubCode(_prev: RedeemState, form: FormData): Promise<RedeemState> {
  const input = form.get('code');
  if (typeof input !== 'string' || input.length > MAX_INPUT) return { outcome: 'invalid' };
  const keys = subCodeKeys();
  if (!subPortalConfigured() || !keys) return { error: 'subPortalNotConfigured' };
  const code = normalizeAccessCode(input);
  if (!code) return { outcome: 'invalid' };

  const env = serverEnv();
  const device = deviceKey(await subDeviceId(), keys);
  const network = ipKey(
    clientIp(await headers(), env.CLIENT_IP_HEADER, env.TRUSTED_PROXY_HOPS),
    keys,
  );
  let result;
  try {
    result = await redeemCode(codeMacs(code, keys), device, network);
  } catch (e) {
    return { error: reportError('redeemSubCode', e as { code?: string; message?: string }) };
  }

  switch (result.outcome) {
    case 'ok':
      await setSubSessionCookie(result.token!, result.expiresAt!);
      return redirect('/suppleance/plan');
    case 'wait':
      // A short prefix of the keyed hashes only: enough to follow one device or network.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'sub_portal.throttled',
          device: device.slice(0, 8),
          network: network.slice(0, 8),
          retryAfter: result.retryAfter,
        }),
      );
      return { outcome: 'wait', retryAfter: Math.max(1, result.retryAfter ?? 30) };
    default:
      return { outcome: result.outcome };
  }
}

/** 'expired': the access ended (the cookie is forgotten); the page goes back to the start. */
export type PollResult = { status: 'expired' | 'unchanged' | 'changed' | 'waiting' };

/**
 * The plan page checks every minute whether the plan changed (the teacher can edit during the
 * day) or was released. `knownVersion` is the content version shown, or null while waiting for
 * release. Never audited.
 */
export async function pollSubPortal(
  knownVersion: number | null,
): Promise<ActionResult<PollResult>> {
  if (knownVersion !== null && !z.number().int().min(0).safeParse(knownVersion).success) {
    return fail('invalid');
  }
  if (!subPortalConfigured()) return fail('subPortalNotConfigured');
  const token = await readSubToken();
  if (!token) return ok({ status: 'expired' });
  try {
    const day = await loadDay(token, knownVersion, 'poll');
    if (!day) {
      await clearSubSessionCookie();
      return ok({ status: 'expired' });
    }
    if (!day.context.released) return ok({ status: knownVersion === null ? 'waiting' : 'changed' });
    return ok({ status: day.plan === 'unchanged' ? 'unchanged' : 'changed' });
  } catch (e) {
    return fail(reportError('pollSubPortal', e as { code?: string; message?: string }));
  }
}

export interface SubAlertView {
  alertId: string;
  studentId: string;
  classId: string;
  category: AlertCategory;
  /** Null when it cannot be decrypted. */
  text: string | null;
}

export type SubAlertsResult =
  { status: 'ok'; alerts: SubAlertView[] } | { status: 'expired' } | { status: 'notReleased' };

/**
 * « Alertes de sécurité ou médicales »: every tap is audited per class by the database. The
 * session is checked again after reading, so an empty list always means "no alert", never "your
 * access just ended". Decrypted here, shown on screen only, never stored or printed.
 */
export async function revealSubAlerts(
  knownVersion: number,
): Promise<ActionResult<SubAlertsResult>> {
  if (!z.number().int().min(0).safeParse(knownVersion).success) return fail('invalid');
  const ring = parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
  if (!ring) return fail('alertsKeyMissing');
  if (!subPortalConfigured()) return fail('subPortalNotConfigured');
  const token = await readSubToken();
  if (!token) return ok({ status: 'expired' });
  try {
    const rows = await portalAlerts(token);
    const day = await loadDay(token, knownVersion, 'poll');
    if (!day) {
      await clearSubSessionCookie();
      return ok({ status: 'expired' });
    }
    if (!day.context.released) return ok({ status: 'notReleased' });
    return ok({
      status: 'ok',
      alerts: rows.map((a) => {
        let text: string | null = null;
        try {
          text = decryptAlert(a.body_ciphertext, a.student_id, ring);
        } catch {
          text = null; // shown as "cannot be decrypted"
        }
        return {
          alertId: a.alert_id,
          studentId: a.student_id,
          classId: a.class_id,
          category: a.category,
          text,
        };
      }),
    });
  } catch (e) {
    return fail(reportError('revealSubAlerts', e as { code?: string; message?: string }));
  }
}

const reportInputSchema = z.object({
  content: subReportContentSchema,
  notes: subReportNotesSchema,
  /** The plan version the page shows: the server then does not reload the whole plan. */
  knownVersion: z.number().int().min(0).nullable(),
});

export type SubReportInput = z.input<typeof reportInputSchema>;

/**
 * What saving the report answered. 'expired': the access ended (the cookie is forgotten);
 * 'lockedOtherDevice': another device is writing the report; 'confirmed': the teacher already
 * confirmed it; 'alreadySubmitted': a draft save after sending (send again to change it).
 */
export type SubReportSaveResult =
  | { status: 'saved' | 'submitted'; updatedAt: string }
  | {
      status: 'expired' | 'notReleased' | 'confirmed' | 'lockedOtherDevice' | 'alreadySubmitted';
    };

/**
 * Saves or sends the report of this device's session (DECISIONS D-054). The free text is
 * encrypted here with the alerts key ring, bound to the session's plan; outcomes and absent
 * students go in plain. The database checks every id against the plan's classes.
 */
async function writeSubReport(
  context: string,
  input: SubReportInput,
  submit: boolean,
): Promise<ActionResult<SubReportSaveResult>> {
  const parsed = parseInput(reportInputSchema, input);
  if (!parsed.ok) return parsed.result;
  if (!subPortalConfigured()) return fail('subPortalNotConfigured');
  const token = await readSubToken();
  if (!token) return ok({ status: 'expired' });
  const { content, notes, knownVersion } = parsed.data;
  try {
    const day = await loadDay(token, knownVersion, 'poll');
    if (!day) {
      await clearSubSessionCookie();
      return ok({ status: 'expired' });
    }
    let sealed = null;
    if (hasReportNotes(notes)) {
      const ring = parseKeyRing(serverEnv().ALERTS_ENCRYPTION_KEYS);
      if (!ring) return fail('encryptionKeyMissing');
      sealed = encryptReportNotes(notes, day.context.planId, ring);
    }
    const result = await saveReport(token, content, sealed, submit);
    switch (result.outcome) {
      case 'saved':
      case 'submitted':
        return ok({ status: result.outcome, updatedAt: result.updatedAt! });
      case 'expired':
        await clearSubSessionCookie();
        return ok({ status: 'expired' });
      case 'not_released':
        return ok({ status: 'notReleased' });
      case 'locked_other_device':
        return ok({ status: 'lockedOtherDevice' });
      case 'already_submitted':
        return ok({ status: 'alreadySubmitted' });
      default:
        return ok({ status: 'confirmed' });
    }
  } catch (e) {
    return fail(reportError(context, e as { code?: string; message?: string }));
  }
}

/** The report's autosave: a draft on the server, 3 s after the last change. */
export async function saveSubReport(
  input: SubReportInput,
): Promise<ActionResult<SubReportSaveResult>> {
  return writeSubReport('saveSubReport', input, false);
}

/**
 * « Envoyer le suivi »: sends the report. Lessons marked « Terminé » count as done until the
 * teacher confirms them; sending again replaces what was sent.
 */
export async function submitSubReport(
  input: SubReportInput,
): Promise<ActionResult<SubReportSaveResult>> {
  return writeSubReport('submitSubReport', input, true);
}

/** « Terminer ma journée »: ends this device's session and forgets it. */
export async function endSubSession(): Promise<ActionResult> {
  const token = await readSubToken();
  if (token && subPortalConfigured()) {
    try {
      await endPortalSession(token);
    } catch (e) {
      return fail(reportError('endSubSession', e as { code?: string; message?: string }));
    }
  }
  await clearSubSessionCookie();
  return okVoid();
}

/** The portal's FR/EN switch: only the language cookie (no account to remember it on). */
export async function setPortalLocale(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail('invalid');
  await writeLocaleCookie(locale);
  return okVoid();
}
