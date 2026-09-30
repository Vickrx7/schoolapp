'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { cn } from '../../../lib/utils';
import { BIG_BUTTON, type AnswerInputProps } from './types';

/**
 * Matching on a class device: one native list per item of the left column (« Choisis… »), the
 * most usable picker on tablets and Chromebooks. « Envoyer » once every item is matched.
 */
export function MatchingInput({
  question,
  lang,
  disabled,
  onSubmit,
}: AnswerInputProps<'matching'>) {
  const t = useTranslations('classPortal');
  const id = useId();
  const left = question.left ?? [];
  const right = question.right ?? [];
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const complete = left.length > 0 && left.every((item) => pairs[item.id]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !disabled) onSubmit({ pairs });
      }}
    >
      <p className="text-[22px] text-slate-800">{t('matching.help')}</p>
      <ol className="space-y-4">
        {left.map((item, i) => (
          <li
            key={item.id}
            className="space-y-2 rounded-2xl border-2 border-slate-300 bg-white p-4"
          >
            <label
              htmlFor={`${id}-${item.id}`}
              lang={lang}
              className="block text-[26px] leading-snug font-semibold text-slate-950"
            >
              <span aria-hidden className="mr-2 text-slate-600 tabular-nums">
                {i + 1}.
              </span>
              {item.text}
            </label>
            <select
              id={`${id}-${item.id}`}
              disabled={disabled}
              value={pairs[item.id] ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                setPairs((current) => {
                  const next = { ...current };
                  if (value) next[item.id] = value;
                  else delete next[item.id];
                  return next;
                });
              }}
              className="block min-h-16 w-full rounded-xl border-2 border-slate-400 bg-white px-4 text-[24px] text-slate-950 focus:border-slate-950 focus:outline-4 focus:outline-offset-2 focus:outline-slate-950"
            >
              <option value="">{t('matching.choose')}</option>
              {/* « Choisis… » is in the interface's language, the choices in the content's. */}
              {right.map((option) => (
                <option key={option.id} value={option.id} lang={lang}>
                  {option.text}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      <button
        type="submit"
        disabled={disabled || !complete}
        className={cn(BIG_BUTTON, 'w-full bg-slate-950 text-white')}
      >
        <Send aria-hidden className="size-7" />
        {t('send')}
      </button>
    </form>
  );
}
