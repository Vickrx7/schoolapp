'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { safeNextPath } from '@/lib/safe-path';
import { createSupabaseServerClient } from '../supabase';

const emailSchema = z.email().max(320);
const codeSchema = z.string().regex(/^\d{6}$/);

export async function requestLoginCode(rawEmail: string): Promise<ActionResult> {
  const email = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!email.success) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    // Invite-only: never create an account from the login page.
    options: { shouldCreateUser: false },
  });

  if (error) {
    if (error.status === 429) return fail('tooManyAttempts');
    // Unknown addresses get the same answer as known ones, so the form cannot be used to
    // find out who has an account.
    if (error.status === 400 || error.status === 422 || /signup/i.test(error.message))
      return okVoid();
    console.error(
      JSON.stringify({
        level: 'error',
        context: 'requestLoginCode',
        status: error.status,
        message: error.message,
      }),
    );
    return fail('unexpected');
  }
  return okVoid();
}

export async function verifyLoginCode(rawEmail: string, rawCode: string): Promise<ActionResult> {
  const email = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  const code = codeSchema.safeParse(rawCode.replace(/\s/g, ''));
  if (!email.success || !code.success) return fail('invalidCode');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: code.data,
    type: 'email',
  });
  if (error) return fail(error.status === 429 ? 'tooManyAttempts' : 'invalidCode');
  return okVoid();
}

/**
 * The emailed link opens a page with a button that posts here. Email security scanners
 * follow links but don't submit forms, so they can no longer burn the one-time token.
 */
export async function confirmLoginLink(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash)) redirect('/auth/confirm?error=1');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  redirect(error ? '/auth/confirm?error=1' : next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
