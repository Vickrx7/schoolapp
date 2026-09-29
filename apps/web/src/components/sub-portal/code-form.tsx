'use client';

import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useErrorText } from '@/hooks/use-action';
import { redeemSubCode, type RedeemState } from '@/server/actions/sub-portal';

/** Reads `code=` from the URL fragment (a texted link), then removes it from the address bar. */
function takeCodeFromFragment(): string | null {
  const match = /(?:^#|&)code=([^&]*)/.exec(window.location.hash);
  if (!match) return null;
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
  try {
    return decodeURIComponent(match[1]!).slice(0, 40);
  } catch {
    return null;
  }
}

/**
 * The access code field and « Commencer ». Accepts the code as typed or read over the phone
 * (lowercase, spaces, hyphens, O for 0, I or L for 1; the server normalizes it). A code from a
 * texted link is only copied into the field: signing in always takes a tap (same reasoning as
 * the staff email link, D-019). The form posts to a server action, so a tap before the page is
 * interactive still works and never puts the code in the address.
 */
export function CodeForm() {
  const t = useTranslations('subPortal');
  const errorText = useErrorText();
  const [code, setCode] = useState('');
  const [state, formAction, pending] = useActionState<RedeemState, FormData>(redeemSubCode, null);

  useEffect(() => {
    const fromLink = takeCodeFromFragment();
    // The fragment only exists in the browser, so the field is filled after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromLink) setCode(fromLink);
  }, []);

  let message: string | null = null;
  if (state && 'error' in state) message = errorText(state.error);
  else if (state?.outcome === 'wait') message = t('wait', { seconds: state.retryAfter });
  else if (state?.outcome === 'used_up') message = t('usedUp');
  else if (state?.outcome === 'revoked') message = t('revoked');
  else if (state?.outcome === 'invalid') message = t('invalid');

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="sub-code" className="block text-sm font-medium text-slate-800">
          {t('codeLabel')}
        </label>
        <Input
          id="sub-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          required
          aria-describedby={message ? 'sub-code-hint sub-code-error' : 'sub-code-hint'}
          aria-invalid={message ? true : undefined}
          className="min-h-14 text-center font-mono text-2xl tracking-widest uppercase"
        />
        <p id="sub-code-hint" className="text-sm text-slate-600">
          {t('codeHint')}
        </p>
        {message ? (
          <p id="sub-code-error" role="alert" className="text-sm font-medium text-red-700">
            {message}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <KeyRound aria-hidden />
        {pending ? t('starting') : t('start')}
      </Button>
    </form>
  );
}
