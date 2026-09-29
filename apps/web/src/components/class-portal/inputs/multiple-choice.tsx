'use client';

import { Check, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Shape, answerLetter, answerStyle } from '../../class-mode/team-mark';
import { cn } from '../../../lib/utils';
import { BIG_BUTTON, type AnswerInputProps } from './types';

/**
 * Multiple choice on a class device: one big button per choice, with its letter, shape and
 * colour as on the projector (A is the blue circle). A 2×2 grid from 600 px wide, one column
 * below. One tap answers a single-answer question; with several answers, taps select and
 * « Envoyer » sends. The chosen buttons stay marked while the answer is on its way.
 */
export function MultipleChoiceInput({
  question,
  lang,
  disabled,
  onSubmit,
}: AnswerInputProps<'multiple_choice'>) {
  const t = useTranslations('classPortal');
  const [selected, setSelected] = useState<string[]>([]);
  const multiple = question.multipleAnswers === true;
  const choices = question.choices ?? [];

  const choose = (id: string) => {
    if (disabled) return;
    if (!multiple) {
      setSelected([id]);
      onSubmit({ choiceIds: [id] });
      return;
    }
    setSelected((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  return (
    <div className="space-y-4">
      {multiple ? <p className="text-[22px] text-slate-800">{t('several')}</p> : null}
      <ul className="grid gap-4 min-[600px]:grid-cols-2">
        {choices.map((choice, i) => {
          const style = answerStyle(i);
          const chosen = selected.includes(choice.id);
          return (
            <li key={choice.id}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={multiple || chosen ? chosen : undefined}
                aria-label={t('choice', { letter: answerLetter(i), text: choice.text })}
                onClick={() => choose(choice.id)}
                className={cn(
                  'flex min-h-24 w-full items-center gap-4 rounded-2xl px-5 py-4 text-left text-white focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950',
                  style.bg,
                  chosen && 'ring-8 ring-slate-950 ring-offset-2',
                  disabled && !chosen && 'opacity-50',
                )}
              >
                <span className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-[28px] font-bold">
                  <Shape shape={style.shape} className="fill-white" />
                  <span>{answerLetter(i)}</span>
                </span>
                <span lang={lang} className="min-w-0 flex-1 text-[26px] leading-snug font-semibold">
                  {choice.text}
                </span>
                {chosen ? <Check aria-hidden className="size-9 shrink-0" strokeWidth={3} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {multiple ? (
        <button
          type="button"
          disabled={disabled || selected.length === 0}
          onClick={() => onSubmit({ choiceIds: selected })}
          className={cn(BIG_BUTTON, 'w-full bg-slate-950 text-white')}
        >
          <Send aria-hidden className="size-7" />
          {t('send')}
        </button>
      ) : null}
    </div>
  );
}
