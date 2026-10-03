'use client';

import { commentLength, fillComment, plainSpaces, unfillComment } from '@lynx/content';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { copyText } from './copy';

/** How long after the last keystroke the counter is read out (a polite announcement). */
const ANNOUNCE_DELAY_MS = 900;

/**
 * « Commentaire » (DECISIONS D-130, D-131): the comment as the teacher reads and edits it, with
 * the student's first name; the device keeps it in template form (`unfillComment`), so it never
 * stores the name. The textarea has no `name` and sits in no form: Enter adds a line, nothing is
 * ever sent. The counter shows « 612 / 1 000 caractères » and says in words when the text is over
 * the limit (never colour alone); it is read out politely once typing pauses. « Copier » copies
 * what is shown, with plain spaces when « Espaces simples à la copie » is on.
 */
export function CommentField({
  editKey,
  label,
  hint,
  firstName,
  template,
  limit,
  plainSpacesOnCopy,
  onTemplateChange,
  textareaRef,
  children,
}: {
  /** The student and subject: a new key shows that comment. */
  editKey: string;
  label: ReactNode;
  hint?: ReactNode;
  firstName: string;
  template: string;
  limit: number;
  plainSpacesOnCopy: boolean;
  onTemplateChange: (template: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** More actions after « Copier ». */
  children?: ReactNode;
}) {
  const t = useTranslations('reportComments.editor');
  const locale = useLocale();
  const id = useId();
  const own = useRef<HTMLTextAreaElement>(null);
  const area = textareaRef ?? own;
  const [local, setLocal] = useState(() => ({
    key: editKey,
    template,
    display: fillComment(template, firstName),
  }));
  // Another student or subject, entries chosen, another tab: show the stored comment again.
  // While the teacher types, what she typed stays as typed (« de Aïcha » is not rewritten
  // under her cursor; the device stores « de {prénom} » and copies « d’Aïcha » next time).
  if (local.key !== editKey || local.template !== template) {
    setLocal({ key: editKey, template, display: fillComment(template, firstName) });
  }
  const display =
    local.key === editKey && local.template === template
      ? local.display
      : fillComment(template, firstName);

  const count = commentLength(display);
  const over = count - limit;
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const counter = t('counter', { count: number(count), limit: number(limit) });
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setAnnounced(over > 0 ? `${counter} ${t('over', { over })}` : counter),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [counter, over, t]);

  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  useEffect(() => {
    if (copied !== 'ok') return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    const text = plainSpacesOnCopy ? plainSpaces(display) : display;
    setCopied((await copyText(text, area.current)) ? 'ok' : 'failed');
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-text`} className="text-base font-semibold text-slate-900">
        {label}
      </Label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      ) : null}
      <Textarea
        ref={area}
        id={`${id}-text`}
        lang="fr-CA"
        rows={7}
        value={display}
        aria-describedby={cn(hint && `${id}-hint`, `${id}-counter`)}
        aria-invalid={over > 0 ? true : undefined}
        className="min-h-44 [field-sizing:content] leading-relaxed"
        onChange={(e) => {
          const next = unfillComment(e.target.value, firstName);
          setLocal({ key: editKey, template: next, display: e.target.value });
          onTemplateChange(next);
        }}
      />
      <div id={`${id}-counter`} className="space-y-0.5 text-sm tabular-nums">
        <p className={over > 0 ? 'font-medium text-red-700' : 'text-slate-600'}>{counter}</p>
        {over > 0 ? (
          <p className="flex items-start gap-1.5 font-medium text-red-700">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('over', { over })}</span>
          </p>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={copy} disabled={!display.trim()}>
          {copied === 'ok' ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === 'ok' ? t('copied') : t('copy')}
        </Button>
        {children}
      </div>
      <p className="sr-only" aria-live="polite">
        {copied === 'ok' ? t('copied') : ''}
      </p>
      {copied === 'failed' ? (
        <p className="text-sm text-amber-900" role="alert">
          {t('copyFailed')}
        </p>
      ) : null}
    </div>
  );
}
