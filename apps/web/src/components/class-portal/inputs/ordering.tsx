'use client';

import { ArrowDown, ArrowUp, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { aroundValue, labelledByIds } from '../../../lib/around-value';
import { cn } from '../../../lib/utils';
import { BIG_BUTTON, type AnswerInputProps } from './types';

/**
 * Ordering on a class device: the items in their display order (never the answer's), each with
 * « Monter » and « Descendre » buttons (no dragging: it is hard on a tablet and impossible with a
 * keyboard). « Envoyer » sends the order on screen. The arrows are named « Monter « … » » from
 * their parts, so the item's text keeps its own language for screen readers (D-090).
 */
export function OrderingInput({
  question,
  lang,
  disabled,
  onSubmit,
}: AnswerInputProps<'ordering'>) {
  const t = useTranslations('classPortal');
  const baseId = useId();
  const [order, setOrder] = useState(() => question.items ?? []);
  const up = aroundValue((text) => t('ordering.upLabel', { text }));
  const down = aroundValue((text) => t('ordering.downLabel', { text }));

  const move = (from: number, to: number) => {
    setOrder((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };

  const arrow =
    'inline-flex size-16 shrink-0 items-center justify-center rounded-xl border-2 border-slate-400 bg-white text-slate-950 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-40';

  return (
    <div className="space-y-5">
      <p className="text-[22px] text-slate-800">{t('ordering.help')}</p>
      <ol className="space-y-3">
        {order.map((item, i) => {
          // By the item's id: the parts follow the item when it moves.
          const id = (part: string) => `${baseId}-${item.id}-${part}`;
          return (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white p-3"
            >
              <span className="w-10 shrink-0 text-center text-[26px] font-bold text-slate-700 tabular-nums">
                {i + 1}.
              </span>
              <span
                id={id('text')}
                lang={lang}
                className="min-w-0 flex-1 text-[26px] leading-snug font-semibold break-words"
              >
                {item.text}
              </span>
              <span id={id('up-before')} hidden>
                {up.before.trim()}
              </span>
              <span id={id('up-after')} hidden>
                {up.after.trim()}
              </span>
              <span id={id('down-before')} hidden>
                {down.before.trim()}
              </span>
              <span id={id('down-after')} hidden>
                {down.after.trim()}
              </span>
              <button
                type="button"
                className={arrow}
                disabled={disabled || i === 0}
                title={t('ordering.up')}
                aria-labelledby={labelledByIds(up, {
                  before: id('up-before'),
                  value: id('text'),
                  after: id('up-after'),
                })}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp aria-hidden className="size-8" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className={arrow}
                disabled={disabled || i === order.length - 1}
                title={t('ordering.down')}
                aria-labelledby={labelledByIds(down, {
                  before: id('down-before'),
                  value: id('text'),
                  after: id('down-after'),
                })}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown aria-hidden className="size-8" strokeWidth={2.5} />
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        disabled={disabled || order.length === 0}
        onClick={() => onSubmit({ orderedIds: order.map((item) => item.id) })}
        className={cn(BIG_BUTTON, 'w-full bg-slate-950 text-white')}
      >
        <Send aria-hidden className="size-7" />
        {t('send')}
      </button>
    </div>
  );
}
