import { getTranslations } from 'next-intl/server';

const NOTICE = ['who', 'collected', 'use', 'ai', 'where', 'access', 'retention', 'rights'] as const;
const TERMS = ['pilot', 'names', 'personal', 'account', 'ai', 'feedback', 'changes'] as const;

/**
 * « Confidentialité et conditions » (DECISIONS D-110): the plain-language privacy notice (from
 * `PRIVACY.md`) and the pilot terms, in the interface's language. **Assumption:** our wording
 * until an Ontario privacy lawyer reviews it. The contacts show only when the server has them.
 */
export async function PrivacyNotice({
  appName,
  termsVersion,
  privacyContact,
  supportContact,
}: {
  appName: string;
  termsVersion: string;
  privacyContact?: string;
  supportContact?: string;
}) {
  const t = await getTranslations('legal');
  return (
    <div className="space-y-8 text-slate-800">
      <p>{t('intro', { appName })}</p>

      <nav aria-labelledby="legal-contents" className="rounded-lg bg-slate-100 p-4">
        <h2 id="legal-contents" className="text-sm font-semibold text-slate-900">
          {t('contents')}
        </h2>
        <ul className="mt-1 text-sm">
          <li>
            <a href="#avis" className="inline-flex min-h-11 items-center text-brand-700 underline">
              {t('noticeHeading')}
            </a>
          </li>
          <li>
            <a
              href="#conditions"
              className="inline-flex min-h-11 items-center text-brand-700 underline"
            >
              {t('termsHeading')}
            </a>
          </li>
        </ul>
      </nav>

      <section aria-labelledby="avis" className="space-y-4">
        <h2 id="avis" className="scroll-mt-20 text-xl font-bold text-slate-900">
          {t('noticeHeading')}
        </h2>
        {NOTICE.map((key) => (
          <div key={key} className="space-y-1">
            <h3 className="font-semibold text-slate-900">{t(`notice.${key}.title`)}</h3>
            <p>{t(`notice.${key}.body`)}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="conditions" className="space-y-3">
        <h2 id="conditions" className="scroll-mt-20 text-xl font-bold text-slate-900">
          {t('termsHeading')}
        </h2>
        <ol className="list-decimal space-y-2 pl-5">
          {TERMS.map((key) => (
            <li key={key}>{t(`terms.${key}`, { appName })}</li>
          ))}
        </ol>
        <p className="text-sm text-slate-600">{t('version', { version: termsVersion })}</p>
      </section>

      <section aria-labelledby="contact" className="space-y-1">
        <h2 id="contact" className="text-xl font-bold text-slate-900">
          {t('contactHeading')}
        </h2>
        {privacyContact ? <p>{t('privacyContact', { email: privacyContact })}</p> : null}
        {supportContact ? <p>{t('supportContact', { email: supportContact })}</p> : null}
        <p>{t('contactBoard')}</p>
        <p className="text-sm text-slate-500">{t('pilotNote')}</p>
      </section>
    </div>
  );
}
