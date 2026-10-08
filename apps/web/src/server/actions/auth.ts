'use server';

import { termsState } from '@lynx/domain';
import { scrubError } from '@lynx/observability';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { safeNextPath } from '@/lib/safe-path';
import { authRateLimitHeaders } from '../auth-rate-limit';
import { serverEnv } from '../env';
import { webLogger } from '../observability';
import { clientIp } from '../sub-portal/client-ip';
import { createSupabaseServerClient, type ServerSupabase } from '../supabase';
import { syncLocaleAtSignIn } from '../locale';

const emailSchema = z.email().max(320);
const codeSchema = z.string().regex(/^\d{6}$/);

/**
 * A sign-in action's answer. When the throttle (DECISIONS D-121) holds the person back,
 * `error` is `signInWait` and `retryAfterMinutes` says for how long.
 */
export type SignInResult<T = undefined> = ActionResult<T> & { retryAfterMinutes?: number };

/** The client's address (the throttle's network, and Auth's own limits on board-hosted installs). */
async function requestClientIp(): Promise<string> {
  const env = serverEnv();
  return clientIp(await headers(), env.CLIENT_IP_HEADER, env.TRUSTED_PROXY_HOPS);
}

/**
 * Asks the sign-in throttle (D-121) before calling Auth: null to go ahead, else what to answer.
 * Refuses when the throttle cannot be asked: sign-in without it would be unprotected.
 */
async function throttled(
  supabase: ServerSupabase,
  kind: 'request' | 'verify',
  email: string,
  ip: string,
): Promise<SignInResult<never> | null> {
  const { data, error } = await supabase
    .rpc('sign_in_attempt', { p_kind: kind, p_email: email, p_ip: ip })
    .maybeSingle();
  if (error || !data) {
    webLogger.error('sign-in throttle unavailable', {
      context: kind === 'request' ? 'requestLoginCode' : 'verifyLoginCode',
      error: error ? scrubError(error) : null,
    });
    return fail('unexpected');
  }
  if (data.outcome === 'ok') return null;
  if (data.outcome === 'new_code') return fail('codeLocked');
  return {
    ...fail('signInWait'),
    retryAfterMinutes: Math.max(1, Math.ceil((data.retry_after ?? 60) / 60)),
  };
}

/** After a sign-in: the address's attempts no longer count (D-121). Never blocks the sign-in. */
async function signInSucceeded(supabase: ServerSupabase): Promise<void> {
  const { error } = await supabase.rpc('sign_in_succeeded');
  if (error) webLogger.error('sign-in throttle not cleared', { error: scrubError(error) });
}

export async function requestLoginCode(rawEmail: string): Promise<SignInResult> {
  const email = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!email.success) return fail('invalid');

  const ip = await requestClientIp();
  const supabase = await createSupabaseServerClient({
    headers: authRateLimitHeaders(ip, serverEnv().AUTH_CLIENT_IP_HEADER_ENABLED),
  });
  const held = await throttled(supabase, 'request', email.data, ip);
  if (held) return held;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    // Invite-only: never create an account from the login page.
    options: { shouldCreateUser: false },
  });

  if (error) {
    if (error.status === 429) return fail('tooManyAttempts');
    // Unknown addresses get the same answer as known ones, so the form cannot be used to
    // find out who has an account. Any other error (e.g. email sign-in turned off on the
    // auth server) is reported, not hidden behind "a code was sent".
    if (error.code === 'otp_disabled' || /signups not allowed/i.test(error.message))
      return okVoid();
    // The status and Auth's error code; the message is scrubbed (it can quote the address).
    webLogger.error('login code not sent', {
      context: 'requestLoginCode',
      status: error.status ?? null,
      authCode: typeof error.code === 'string' ? error.code : null,
      error: scrubError(error),
    });
    return fail('unexpected');
  }
  return okVoid();
}

/**
 * Checks the emailed code. Answers whether the person still has to accept the pilot terms
 * (DECISIONS D-109), so the form goes straight to « Bienvenue » instead of through a page that
 * would send them there. Five wrong codes in a row need a new code (D-121).
 */
export async function verifyLoginCode(
  rawEmail: string,
  rawCode: string,
): Promise<SignInResult<{ termsRequired: boolean }>> {
  const email = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  const code = codeSchema.safeParse(rawCode.replace(/\s/g, ''));
  if (!email.success || !code.success) return fail('invalidCode');

  const ip = await requestClientIp();
  const supabase = await createSupabaseServerClient({
    headers: authRateLimitHeaders(ip, serverEnv().AUTH_CLIENT_IP_HEADER_ENABLED),
  });
  const held = await throttled(supabase, 'verify', email.data, ip);
  if (held) return held;
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: code.data,
    type: 'email',
  });
  if (error) return fail(error.status === 429 ? 'tooManyAttempts' : 'invalidCode');
  await signInSucceeded(supabase);
  await syncLocaleAtSignIn(supabase);
  const userId = data.user?.id;
  if (!userId) return ok({ termsRequired: false });
  const { data: profile } = await supabase.rpc('my_onboarding_state').maybeSingle();
  // No profile (or no access): the app's pages say so.
  return ok({ termsRequired: profile ? termsState(profile.terms_version) === 'required' : false });
}

/**
 * The emailed link opens a page with a button that posts here. Email security scanners
 * follow links but don't submit forms, so they can no longer burn the one-time token. The link
 * cannot be guessed, so it is not throttled: it is the way in when wrong codes locked the code.
 */
export async function confirmLoginLink(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash)) redirect('/auth/confirm?error=1');

  const supabase = await createSupabaseServerClient({
    headers: authRateLimitHeaders(
      await requestClientIp(),
      serverEnv().AUTH_CLIENT_IP_HEADER_ENABLED,
    ),
  });
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (!error) {
    await signInSucceeded(supabase);
    await syncLocaleAtSignIn(supabase);
  }
  redirect(error ? '/auth/confirm?error=1' : next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
