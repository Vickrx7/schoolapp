'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Shape, answerStyle } from '../../class-mode/team-mark';
import { cn } from '../../../lib/utils';
import type { AnswerInputProps } from './types';

/**
 * « Vrai / Faux » on a class device: two tall buttons (the first two answer marks: the blue
 * circle and the orange triangle, with their words). One tap answers.
 */
export function TrueFalseInput({ disabled, onSubmit }: AnswerInputProps<'true_false'>) {
  const t = useTranslations('classPortal.trueFalse');
  const [selected, setSelected] = useState<boolean | null>(null);
  const options = [
    { value: true, label: t('true'), style: answerStyle(0) },
    { value: false, label: t('false'), style: answerStyle(1) },
  ];
  return (
    <ul className="grid gap-4 min-[600px]:grid-cols-2">
      {options.map((option) => {
        const chosen = selected === option.value;
        return (
          <li key={String(option.value)}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={selected === null ? undefined : chosen}
              onClick={() => {
                if (disabled) return;
                setSelected(option.value);
                onSubmit({ value: option.value });
              }}
              className={cn(
                'flex min-h-[32dvh] w-full flex-col items-center justify-center gap-4 rounded-3xl px-6 text-[40px] font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950',
                option.style.bg,
                chosen && 'ring-8 ring-slate-950 ring-offset-2',
                disabled && !chosen && 'opacity-50',
              )}
            >
              <Shape shape={option.style.shape} className="size-16 fill-white" />
              <span className="inline-flex items-center gap-3">
                {option.label}
                {chosen ? <Check aria-hidden className="size-10" strokeWidth={3} /> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
