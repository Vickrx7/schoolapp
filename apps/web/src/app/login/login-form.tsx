'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { welcomeHref } from '@/lib/request-path';
import { requestLoginCode, verifyLoginCode } from '@/server/actions/auth';

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const message = (key: string) => {
    if (key === 'invalidCode' || key === 'tooManyAttempts') return t(key);
    return tErrors(key === 'invalid' ? 'invalid' : 'unexpected');
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestLoginCode(email);
        if (result.ok) setStep('code');
        else setError(message(result.error));
      } catch {
        setError(tErrors('network'));
      }
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await verifyLoginCode(email, code);
        if (result.ok) {
          // The pilot terms first, then the page asked for (D-109).
          router.replace(result.data.termsRequired ? welcomeHref(next) : next);
          router.refresh();
        } else setError(message(result.error));
      } catch {
        setError(tErrors('network'));
      }
    });
  };

  if (step === 'email') {
    return (
      <form onSubmit={sendCode} className="space-y-4" noValidate>
        <Field label={t('emailLabel')} htmlFor="email" error={error}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending || !email}>
          {pending ? t('sending') : t('sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <Notice>
        <p>{t('codeSentTo', { email })}</p>
        <p className="mt-1 text-slate-600">{t('codeHelp')}</p>
      </Notice>
      <Field label={t('codeLabel')} htmlFor="code" error={error}>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          className="text-center text-2xl tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={error ? true : undefined}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || code.length !== 6}>
        {pending ? t('verifying') : t('verify')}
      </Button>
      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
        >
          {t('useAnotherEmail')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => sendCode()} disabled={pending}>
          {t('resend')}
        </Button>
      </div>
    </form>
  );
}
