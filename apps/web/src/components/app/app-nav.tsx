'use client';

import {
  CalendarDays,
  CircleUser,
  ClipboardList,
  House,
  Layers,
  School,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { phoneBarItems, type NavKey } from './nav-items';

type Item = {
  href: string;
  key: NavKey;
  icon: typeof House;
};

const ALL_ITEMS: Item[] = [
  { href: '/today', key: 'today', icon: House },
  { href: '/classes', key: 'classes', icon: Users },
  { href: '/absences', key: 'substitutes', icon: ClipboardList },
  { href: '/differentiate', key: 'differentiate', icon: Layers },
  { href: '/calendar', key: 'calendar', icon: CalendarDays },
  { href: '/school', key: 'school', icon: School },
  { href: '/profile', key: 'profile', icon: CircleUser },
];

export function AppNav({
  appName,
  showTeaching,
  showSubstitutes,
  showDifferentiate,
  showSchool,
}: {
  appName: string;
  showTeaching: boolean;
  /** « Suppléances »: direction and office at a school with the Teaching module. */
  showSubstitutes: boolean;
  showDifferentiate: boolean;
  showSchool: boolean;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const items = ALL_ITEMS.filter((i) => (i.key !== 'today' && i.key !== 'classes') || showTeaching)
    .filter((i) => i.key !== 'substitutes' || showSubstitutes)
    .filter((i) => i.key !== 'differentiate' || showDifferentiate)
    .filter((i) => i.key !== 'school' || showSchool);
  const phoneItems = phoneBarItems(items);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Top bar (all sizes); links shown from tablet width up. */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link href="/today" className="flex items-center gap-2 font-bold text-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-8" />
            <span>{appName}</span>
          </Link>
          <nav aria-label={t('mainNavigation')} className="hidden gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  active(item.href) && 'bg-brand-50 text-brand-700',
                )}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Bottom tab bar on phones. */}
      <nav
        aria-label={t('mainNavigation')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <ul className="mx-auto flex max-w-md justify-around">
          {phoneItems.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active(item.href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight text-slate-500',
                  active(item.href) && 'text-brand-700',
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {t(item.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
