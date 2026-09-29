import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface ChipLink {
  code: string;
  label: string;
  href: string;
  /** The one shown now (`aria-current`). */
  current?: boolean;
}

/**
 * A named row of chips that are links: « Mes années d’études » on the hub, the grades and the
 * subjects of « Parcourir le curriculum ». 44 px targets; the current one is marked for screen
 * readers too.
 */
export function GradeChips({
  label,
  chips,
  labelId,
}: {
  label: string;
  chips: readonly ChipLink[];
  /** The id of the chips' heading, so the list is named by it. */
  labelId: string;
}) {
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium text-slate-700">
        {label}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {chips.map((g) => (
          <li key={g.code}>
            <Link
              href={g.href}
              aria-current={g.current ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
                g.current
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {g.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
