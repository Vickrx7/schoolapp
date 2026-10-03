'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { cn } from '../../../lib/utils';
import { BIG_BUTTON, type AnswerInputProps } from './types';

/** `app.class_grade` takes at most 100 characters. */
const MAX_LENGTH = 100;

/**
 * A short answer on a class device (DECISIONS D-088): « Ta réponse » and « Envoyer ». The text
 * stays in this component until it is sent; the database grades it in the transaction that
 * receives it and keeps only its score. Autocomplete, autocorrect, automatic capitals and spell
 * check are off (Chrome's enhanced spell check would send the text to Google), and the field
 * carries the content's language.
 */
export function ShortAnswerInput({ lang, disabled, onSubmit }: AnswerInputProps<'short_answer'>) {
  const t = useTranslations('classPortal');
  const id = useId();
  const [text, setText] = useState('');
  const ready = text.trim().length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !disabled) onSubmit({ text: text.trim() });
      }}
    >
      <label htmlFor={id} className="block text-[24px] font-semibold text-slate-950">
        {t('shortAnswer')}
      </label>
      <input
        id={id}
        name="reponse"
        type="text"
        lang={lang}
        value={text}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        data-lpignore="true"
        data-1p-ignore="true"
        onChange={(e) => setText(e.target.value)}
        className="block min-h-16 w-full rounded-xl border-2 border-slate-400 bg-white px-4 text-[28px] text-slate-950 focus:border-slate-950 focus:outline-4 focus:outline-offset-2 focus:outline-slate-950"
      />
      <button
        type="submit"
        disabled={disabled || !ready}
        className={cn(BIG_BUTTON, 'w-full bg-slate-950 text-white')}
      >
        <Send aria-hidden className="size-7" />
        {t('send')}
      </button>
    </form>
  );
}
