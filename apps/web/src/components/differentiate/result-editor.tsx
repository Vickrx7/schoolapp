'use client';

import { Printer, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction, useErrorText } from '@/hooks/use-action';
import { forgetSentDrafts, useDraft } from '@/hooks/use-draft';
import { cn } from '@/lib/utils';
import { saveDifferentiation } from '@/server/actions/differentiate';
import {
  resolveFieldErrors,
  toEditable,
  versionPayload,
  type EditableVersion,
  type EditorVersion,
  type LineNumbers,
} from './result-lines';
import { StudentCopies } from './student-copies';

export type { EditorVersion } from './result-lines';

/**
 * A finished « Texte différencié » request, before it is saved: the versions side by side (one
 * at a time on phones), editable, printable per level. « Enregistrer » makes it an ordinary
 * library draft (D-073) and opens its page in the library, where it is edited from then on.
 */
export function ResultEditor({
  id,
  userId,
  initial,
}: {
  /** The request (AI job). */
  id: string;
  userId: string;
  initial: { title: string; objective: string; versions: EditorVersion[] };
}) {
  const t = useTranslations('differentiate');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const router = useRouter();
  const draft = useDraft(`differentiate:job:${userId}:${id}`, {
    title: initial.title,
    objective: initial.objective,
    versions: initial.versions.map(toEditable),
  });
  const v = draft.value;
  const [selected, setSelected] = useState(0);
  const [printing, setPrinting] = useState<number[]>([]);

  // The request succeeded: the new-request draft kept in case it failed can go.
  useEffect(() => {
    forgetSentDrafts(`differentiate:new:${userId}`, id);
  }, [userId, id]);

  const build = () => {
    const versions = v.versions.map(versionPayload);
    return {
      payload: {
        title: v.title,
        objective: v.objective,
        versions: versions.map((x) => x.payload),
      },
      lines: versions.map((x) => x.lines),
    };
  };
  // Line numbers of what was last sent, to point at the line a field error comes from.
  const [sentLines, setSentLines] = useState<LineNumbers[]>([]);

  const saver = useAction(saveDifferentiation, {
    onSuccess: ({ itemId, skippedLevels }) => {
      draft.clear();
      if (skippedLevels) toast.warning(t('savedWithoutLevels', { count: skippedLevels }));
      else toast.success(t('savedToLibrary'));
      // An ordinary library draft from now on (D-073).
      router.push(`/library/items/${itemId}`);
    },
  });
  const pending = saver.pending;
  const errors = resolveFieldErrors(saver.fieldErrors, sentLines);
  const fieldError = (key: string) => {
    const e = errors.fields[key];
    if (!e) return undefined;
    const message = errorText(e.error) ?? undefined;
    return e.line ? t('lineError', { line: e.line, error: message ?? '' }) : message;
  };

  const save = async () => {
    const { payload, lines } = build();
    setSentLines(lines);
    const result = await saver.run(id, payload);
    if (result && !result.ok && result.fieldErrors) {
      // Say so even when the field is out of sight (phones show one level at a time).
      const resolved = resolveFieldErrors(result.fieldErrors, lines);
      if (resolved.firstVersion !== null) setSelected(resolved.firstVersion);
      toast.error(
        Object.keys(resolved.fields).length
          ? t('fixErrors')
          : errorText(resolved.unmatched[0] ?? result.error),
      );
    }
  };

  const updateVersion = (index: number, field: keyof EditableVersion, value: string) =>
    draft.setValue((prev) => ({
      ...prev,
      versions: prev.versions.map((x, i) => (i === index ? { ...x, [field]: value } : x)),
    }));

  const print = (indexes: number[]) => {
    flushSync(() => setPrinting(indexes));
    window.print();
  };

  return (
    <>
      <div className="space-y-4 print:hidden">
        {draft.restored ? (
          <Notice tone="info" className="flex flex-wrap items-center justify-between gap-2">
            <span>{tCommon('draftRestored')}</span>
            <Button variant="ghost" onClick={() => draft.discard()}>
              {tCommon('discardDraft')}
            </Button>
          </Notice>
        ) : null}
        <Notice tone="info" className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('aiNotice')}</span>
        </Notice>

        <Card>
          <CardBody className="space-y-4 pt-4">
            <Field label={t('titleLabel')} htmlFor="result-title" error={fieldError('title')}>
              <Input
                id="result-title"
                value={v.title}
                maxLength={200}
                onChange={(e) => draft.update('title', e.target.value)}
              />
            </Field>
            <Field
              label={t('objective')}
              htmlFor="result-objective"
              error={fieldError('objective')}
            >
              <Textarea
                id="result-objective"
                value={v.objective}
                maxLength={1000}
                className="min-h-16"
                onChange={(e) => draft.update('objective', e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={pending}>
                {pending ? tCommon('saving') : t('saveToLibrary')}
              </Button>
              <Button variant="secondary" onClick={() => print(v.versions.map((_, i) => i))}>
                <Printer aria-hidden />
                {t('printAll')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Phones: one level at a time. */}
        <div role="group" aria-label={t('levelTabs')} className="flex flex-wrap gap-2 md:hidden">
          {v.versions.map((x, i) => (
            <Button
              key={x.languageLevelId}
              variant={i === selected ? 'primary' : 'secondary'}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
            >
              {x.levelLabel}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {v.versions.map((x, i) => {
            const idp = `v${i}`;
            const error = (field: string) => fieldError(`versions.${i}.${field}`);
            return (
              <Card
                key={x.languageLevelId}
                className={cn(i !== selected && 'hidden md:block')}
                aria-labelledby={`${idp}-level`}
              >
                <CardHeader>
                  <CardTitle id={`${idp}-level`}>{x.levelLabel}</CardTitle>
                  <Button variant="ghost" onClick={() => print([i])}>
                    <Printer aria-hidden />
                    <span className="sr-only sm:not-sr-only">{t('printLevel')}</span>
                  </Button>
                </CardHeader>
                <CardBody className="space-y-3">
                  <Field label={t('versionTitle')} htmlFor={`${idp}-title`} error={error('title')}>
                    <Input
                      id={`${idp}-title`}
                      value={x.title}
                      maxLength={200}
                      onChange={(e) => updateVersion(i, 'title', e.target.value)}
                    />
                  </Field>
                  <Field label={t('versionText')} htmlFor={`${idp}-text`} error={error('text')}>
                    <Textarea
                      id={`${idp}-text`}
                      value={x.text}
                      className="min-h-64"
                      onChange={(e) => updateVersion(i, 'text', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('glossary')}
                    htmlFor={`${idp}-glossary`}
                    hint={t('glossaryHint')}
                    error={error('glossary')}
                  >
                    <Textarea
                      id={`${idp}-glossary`}
                      value={x.glossary}
                      onChange={(e) => updateVersion(i, 'glossary', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('questions')}
                    htmlFor={`${idp}-questions`}
                    hint={t('onePerLine')}
                    error={error('questions')}
                  >
                    <Textarea
                      id={`${idp}-questions`}
                      value={x.questions}
                      onChange={(e) => updateVersion(i, 'questions', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('visualSupports')}
                    htmlFor={`${idp}-visual`}
                    hint={t('onePerLine')}
                    error={error('visualSupports')}
                  >
                    <Textarea
                      id={`${idp}-visual`}
                      value={x.visualSupports}
                      onChange={(e) => updateVersion(i, 'visualSupports', e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('teacherNote')}
                    htmlFor={`${idp}-note`}
                    error={error('teacherNote')}
                  >
                    <Textarea
                      id={`${idp}-note`}
                      value={x.teacherNote}
                      className="min-h-16"
                      onChange={(e) => updateVersion(i, 'teacherNote', e.target.value)}
                    />
                  </Field>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>

      <StudentCopies versions={v.versions} printing={printing} />
    </>
  );
}
