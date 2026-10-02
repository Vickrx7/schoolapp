import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/**
 * The footer of the signed-in app (DECISIONS D-110, D-117): « Confidentialité », « Nouveautés »
 * and the version that runs (`APP_RELEASE`). On phones it clears the bottom tab bar.
 */
export async function AppFooter({ release }: { release: string }) {
  const t = await getTranslations();
  const link =
    'inline-flex min-h-11 items-center underline-offset-2 hover:text-slate-900 hover:underline';
  return (
    <footer
      aria-label={t('legal.footer')}
      className="mx-auto max-w-5xl px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6 print:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-4 border-t border-slate-200 pt-2 text-sm text-slate-600">
        <Link href="/confidentialite" className={link}>
          {t('legal.footerLink')}
        </Link>
        <Link href="/nouveautes" className={link}>
          {t('releaseNotes.title')}
        </Link>
        <span className="ml-auto tabular-nums" data-testid="app-version">
          {t('common.version', { version: release })}
        </span>
      </div>
    </footer>
  );
}
