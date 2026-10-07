'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row of radio buttons drawn as buttons (« Neutre · Féminin · Masculin », « 1 2 3 4 »): native
 * radios in a fieldset, so arrow keys move between them and screen readers name the group by its
 * legend; each target is at least 44 px high. They sit in no form: the choice stays in the
 * page (and the device draft).
 */
export function Segmented<V extends string | number>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns,
  legendClassName,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: readonly { value: V; label: ReactNode; srLabel?: string }[];
  value: V | null;
  onChange: (value: V) => void;
  /** Tailwind grid columns, e.g. `grid-cols-4`. */
  columns: string;
  legendClassName?: string;
}) {
  const name = useId();
  const hintId = `${name}-hint`;
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className={cn('text-sm font-medium text-slate-800', legendClassName)}>
        {legend}
      </legend>
      <div className={cn('grid gap-2', columns)}>
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={cn(
              'relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-center text-sm font-medium text-slate-800 select-none hover:bg-slate-50',
              'has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:text-white',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
            )}
          >
            {/* Transparent over its whole button: the 44 px target is the radio itself. */}
            <input
              type="radio"
              className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0"
              name={name}
              value={String(o.value)}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.srLabel ? (
              <>
                <span aria-hidden>{o.label}</span>
                <span className="sr-only">{o.srLabel}</span>
              </>
            ) : (
              o.label
            )}
          </label>
        ))}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
