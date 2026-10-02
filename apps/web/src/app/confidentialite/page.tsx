import { CURRENT_TERMS_VERSION } from '@lynx/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LanguageSwitch } from '@/components/app/language-switch';
import { PrivacyNotice } from '@/components/legal/privacy-notice';
import { APP_NAME } from '@/lib/app-name';
import { serverEnv } from '@/server/env';

// The app's name and the contacts are read when the server runs (DECISIONS D-113).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return { title: t('title') };
}

/**
 * « Confidentialité et conditions » (DECISIONS D-110): public (`PUBLIC_PATHS` in proxy.ts), linked
 * from the login page, « Bienvenue », the app's footer and the substitute portal.
 */
export default async function PrivacyPage() {
  const t = await getTranslations('legal');
  const env = serverEnv();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-8" />
            <span>{APP_NAME}</span>
          </Link>
          <span className="ml-auto">
            <LanguageSwitch />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-16">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
        <PrivacyNotice
          appName={APP_NAME}
          termsVersion={CURRENT_TERMS_VERSION}
          privacyContact={env.PRIVACY_CONTACT_EMAIL}
          supportContact={env.SUPPORT_EMAIL}
        />
      </main>
    </div>
  );
}
