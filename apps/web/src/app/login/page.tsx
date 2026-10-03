import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LanguageSwitch } from '@/components/app/language-switch';
import { APP_NAME } from '@/lib/app-name';
import { safeNextPath } from '@/lib/safe-path';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations('auth');
  const tLegal = await getTranslations('legal');
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-12" />
          <span className="text-xl font-bold">{APP_NAME}</span>
          <span className="ml-auto">
            <LanguageSwitch />
          </span>
        </div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-2 mb-6 text-slate-600">{t('intro')}</p>
        <LoginForm next={safeNextPath(next)} />
        {/* The privacy notice and the pilot terms, before anyone signs in (D-110). */}
        <p className="mt-8 text-center text-sm">
          <Link
            href="/confidentialite"
            className="inline-flex min-h-11 items-center text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            {tLegal('loginLink')}
          </Link>
        </p>
      </div>
    </main>
  );
}
