'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = ['units', 'year', 'coverage'] as const;

const SEGMENT: Record<(typeof TABS)[number], string> = {
  units: '',
  year: '/year',
  coverage: '/coverage',
};

/**
 * The sections of a class's « Planification » (DECISIONS D-125, D-126): « Unités » (the units and
 * their pages), « Mon année » and « Couverture ». Inside the class's « Planification » tab, which
 * stays the current class tab; no new navigation item (D-118).
 */
export function PlanningTabs({ classId }: { classId: string }) {
  const t = useTranslations('units.tabs');
  const pathname = usePathname();
  const base = `/classes/${classId}/planning`;
  const current = (tab: (typeof TABS)[number]) =>
    tab === 'units'
      ? !TABS.some((other) => other !== 'units' && pathname.startsWith(`${base}${SEGMENT[other]}`))
      : pathname === `${base}${SEGMENT[tab]}` || pathname.startsWith(`${base}${SEGMENT[tab]}/`);
  return (
    <nav aria-label={t('label')}>
      <ul className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = current(tab);
          return (
            <li key={tab}>
              <Link
                href={`${base}${SEGMENT[tab]}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap ring-1 ring-slate-300 ring-inset',
                  active
                    ? 'bg-brand-700 text-white ring-brand-700'
                    : 'bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900',
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
