import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-start justify-between gap-3 p-4 pb-2', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold text-slate-900', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />;
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-50 text-brand-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  className,
  tone = 'info',
  ...props
}: ComponentProps<'div'> & { tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div
      role="status"
      className={cn('rounded-lg border p-3 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
