'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = ['students', 'timetable', 'planning', 'substitute', 'settings'] as const;
type Tab = (typeof TABS)[number] | 'class-mode' | 'bulletins';

/**
 * The class's tabs. « Mode classe » (quizzes on devices, DECISIONS D-090) comes after
 * « Planification » when the school has the Library module, then « Bulletins » (report card
 * comments, D-135) for the homeroom and subject teachers there; the row scrolls sideways on
 * phones.
 */
export function ClassTabs({
  classId,
  classMode = false,
  bulletins = false,
}: {
  classId: string;
  classMode?: boolean;
  bulletins?: boolean;
}) {
  const t = useTranslations('classes.tabs');
  const tClassMode = useTranslations('classMode');
  const pathname = usePathname();
  const tabs: Tab[] = [
    ...TABS.slice(0, 3),
    ...(classMode ? (['class-mode'] as const) : []),
    ...(bulletins ? (['bulletins'] as const) : []),
    ...TABS.slice(3),
  ];
  return (
    <nav
      className="-mx-4 overflow-x-auto border-b border-slate-200 px-4"
      aria-label={t('overview')}
    >
      <ul className="flex gap-1">
        {tabs.map((tab) => {
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
                {tab === 'class-mode' ? tClassMode('tab') : t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
