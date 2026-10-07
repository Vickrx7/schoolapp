'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = ['students', 'timetable', 'planning', 'settings'] as const;

export function ClassTabs({ classId }: { classId: string }) {
  const t = useTranslations('classes.tabs');
  const pathname = usePathname();
  return (
    <nav
      className="-mx-4 overflow-x-auto border-b border-slate-200 px-4"
      aria-label={t('overview')}
    >
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const href = `/classes/${classId}/${tab}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-slate-600 hover:text-slate-900',
                  active && 'border-brand-600 text-brand-700',
                )}
              >
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
