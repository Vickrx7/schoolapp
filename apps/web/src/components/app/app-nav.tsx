'use client';

import {
  CalendarDays,
  CircleUser,
  ClipboardList,
  Ellipsis,
  House,
  Layers,
  Library,
  School,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isNavActive, phoneBar, type NavKey } from './nav-items';

type Item = {
  href: string;
  key: NavKey;
  icon: typeof House;
};

const ALL_ITEMS: Item[] = [
  { href: '/today', key: 'today', icon: House },
  { href: '/classes', key: 'classes', icon: Users },
  { href: '/absences', key: 'substitutes', icon: ClipboardList },
  { href: '/library', key: 'library', icon: Library },
  { href: '/differentiate', key: 'differentiate', icon: Layers },
  { href: '/calendar', key: 'calendar', icon: CalendarDays },
  { href: '/school', key: 'school', icon: School },
  { href: '/profile', key: 'profile', icon: CircleUser },
];

const phoneTab =
  'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight text-slate-500';

export function AppNav({
  appName,
  showTeaching,
  showSubstitutes,
  showLibrary,
  showDifferentiate,
  showSchool,
}: {
  appName: string;
  showTeaching: boolean;
  /** « Suppléances »: direction and office at a school with the Teaching module. */
  showSubstitutes: boolean;
  /** « Ressources »: a school with the Library module, or a reviewer designation (D-078). */
  showLibrary: boolean;
  /** « Différencier »: only where « Ressources » is not shown (the library links to it). */
  showDifferentiate: boolean;
  showSchool: boolean;
}) {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = ALL_ITEMS.filter((i) => (i.key !== 'today' && i.key !== 'classes') || showTeaching)
    .filter((i) => i.key !== 'substitutes' || showSubstitutes)
    .filter((i) => i.key !== 'library' || showLibrary)
    .filter((i) => i.key !== 'differentiate' || showDifferentiate)
    .filter((i) => i.key !== 'school' || showSchool);
  const { bar, more } = phoneBar(items);
  const active = (item: Item) => isNavActive(item, pathname);
  const moreActive = more.some(active);

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
                aria-current={active(item) ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  active(item) && 'bg-brand-50 text-brand-700',
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
          {bar.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active(item) ? 'page' : undefined}
                className={cn(phoneTab, active(item) && 'text-brand-700')}
              >
                <item.icon className="size-5" aria-hidden />
                {t(item.key)}
              </Link>
            </li>
          ))}
          {more.length ? (
            <li className="flex-1">
              {/* « Plus »: the items that do not fit, in a sheet (D-078). */}
              <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
                <DialogTrigger
                  aria-current={moreActive ? 'page' : undefined}
                  className={cn(phoneTab, moreActive && 'text-brand-700')}
                >
                  <Ellipsis className="size-5" aria-hidden />
                  {t('more')}
                </DialogTrigger>
                <DialogContent title={t('more')} closeLabel={tCommon('close')}>
                  <ul className="space-y-1">
                    {more.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active(item) ? 'page' : undefined}
                          onClick={() => setMoreOpen(false)}
                          className={cn(
                            'flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-medium text-slate-700 hover:bg-slate-100',
                            active(item) && 'bg-brand-50 text-brand-700',
                          )}
                        >
                          <item.icon className="size-5" aria-hidden />
                          {t(item.key)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </DialogContent>
              </Dialog>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}
