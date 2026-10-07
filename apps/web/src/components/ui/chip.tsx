import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A tap target that behaves as a radio button or a checkbox (a native input, visually hidden):
 * choices on a phone without typing (D-034).
 */
export function Chip({
  type = 'radio',
  name,
  value,
  checked,
  onChange,
  disabled,
  children,
}: {
  type?: 'radio' | 'checkbox';
  name: string;
  value?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
        checked
          ? 'border-brand-600 bg-brand-50 text-brand-800'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        disabled && 'cursor-default opacity-60',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      {children}
    </label>
  );
}
