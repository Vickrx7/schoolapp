'use client';

import { Copy, Mail, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { AppLocale } from '@/i18n/config';
import type { InviteMessage } from '@/server/invite-message';

/**
 * The welcome message to send (DECISIONS D-107), in French or English: « Courriel » and « Texto »
 * open the inviter's own apps with it, « Copier le message » puts it on the clipboard. Our servers
 * send nothing.
 */
export function InviteMessageCard({
  messages,
  initialLocale,
}: {
  messages: Record<AppLocale, InviteMessage>;
  initialLocale: AppLocale;
}) {
  const t = useTranslations('board.invite');
  const [locale, setLocale] = useState<AppLocale>(initialLocale);
  const message = messages[locale];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('messageLanguage')} className="flex flex-wrap gap-2">
        {(['fr-CA', 'en-CA'] as const).map((l) => (
          <Button
            key={l}
            variant={l === locale ? 'primary' : 'secondary'}
            aria-pressed={l === locale}
            lang={l === 'fr-CA' ? 'fr' : 'en'}
            onClick={() => setLocale(l)}
          >
            {l === 'fr-CA' ? t('french') : t('english')}
          </Button>
        ))}
      </div>
      <div
        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-900"
        lang={locale === 'fr-CA' ? 'fr' : 'en'}
        aria-label={t('messageLabel')}
        role="region"
        data-testid="invite-message"
      >
        {message.body}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href={message.mailto}>
            <Mail aria-hidden />
            {t('sendEmail')}
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={message.sms}>
            <MessageSquare aria-hidden />
            {t('sendSms')}
          </a>
        </Button>
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy aria-hidden />
          {t('copy')}
        </Button>
      </div>
      <p className="text-sm text-slate-600">{t('noEmailSent')}</p>
    </div>
  );
}
