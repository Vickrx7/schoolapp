'use client';

import { KeyRound, Mail, MessageSquare, Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import { formatInstantTime, formatLocalDate } from '@/lib/format';
import { issueSubCode } from '@/server/actions/sub-codes';
import type { ShownCode, SubCodeContext } from './types';
import { WelcomeSheet } from './welcome-sheet';

/**
 * « Générer un code »: makes a new code and shows it once, large, with the welcome sheet to
 * print and « Texto » / « Courriel » links that open the issuer's own apps (the app stores no
 * phone number or address, and the messages carry no teacher or student name). Closing the
 * dialog forgets the code: nobody can look it up again (D-050).
 */
export function CodeRevealDialog({
  context,
  label,
  variant = 'secondary',
  disabled = false,
}: {
  context: SubCodeContext;
  label: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const t = useTranslations('subCodes');
  const locale = useLocale();
  const [shown, setShown] = useState<ShownCode | null>(null);
  const issue = useAction(issueSubCode, {
    onSuccess: (data) =>
      setShown({
        code: data.code,
        validFrom: data.validFrom,
        expiresAt: data.expiresAt,
        baseUrl: data.baseUrl,
      }),
  });

  const date = formatLocalDate(context.planDate, locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const from = shown ? formatInstantTime(shown.validFrom, context.timezone, locale) : '';
  const until = shown ? formatInstantTime(shown.expiresAt, context.timezone, locale) : '';
  const values = shown
    ? {
        school: context.schoolShortName ?? context.schoolName,
        date,
        code: shown.code,
        url: `${shown.baseUrl}/suppleance#code=${shown.code.replace('-', '')}`,
        from,
        until,
      }
    : null;

  return (
    <>
      <Button
        variant={variant}
        disabled={disabled || issue.pending}
        onClick={() => void issue.run(context.planId)}
      >
        <KeyRound aria-hidden />
        {issue.pending ? t('generating') : label}
      </Button>
      <Dialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) setShown(null);
        }}
      >
        {shown && values ? (
          <DialogContent
            title={t('dialogTitle')}
            description={t('shownOnce')}
            closeLabel={t('close')}
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-sm text-slate-600">{t('codeLabel')}</p>
                <p
                  className="font-mono text-4xl font-bold tracking-widest text-slate-900 select-all"
                  data-testid="sub-code"
                >
                  {shown.code}
                </p>
                <p className="mt-2 text-sm text-slate-700">{t('validOn', { date, from, until })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => window.print()}>
                  <Printer aria-hidden />
                  {t('print')}
                </Button>
                <Button asChild variant="secondary">
                  <a href={`sms:?&body=${encodeURIComponent(t('smsBody', values))}`}>
                    <MessageSquare aria-hidden />
                    {t('sms')}
                  </a>
                </Button>
                <Button asChild variant="secondary">
                  <a
                    href={`mailto:?subject=${encodeURIComponent(t('emailSubject', values))}&body=${encodeURIComponent(t('emailBody', values))}`}
                  >
                    <Mail aria-hidden />
                    {t('email')}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-slate-600">{t('sendHint')}</p>
            </div>
            <WelcomeSheet context={context} shown={shown} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
