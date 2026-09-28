'use client';

import { Printer, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { cn } from '@/lib/utils';
import {
  deleteSavedDifferentiation,
  saveDifferentiation,
  updateSavedDifferentiation,
} from '@/server/actions/differentiate';

export interface EditorVersion {
  languageLevelId: string;
  levelLabel: string;
  title: string;
  text: string;
  glossary: { term: string; definition: string }[];
  visualSupports: string[];
  questions: string[];
  teacherNote: string;
}

interface EditableVersion {
  languageLevelId: string;
  levelLabel: string;
  title: string;
  text: string;
  glossary: string;
  visualSupports: string;
  questions: string;
  teacherNote: string;
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** "mot : définition" per line; a line without a colon is a word without definition. */
function parseGlossary(s: string) {
  return lines(s).map((l) => {
    const i = l.indexOf(':');
    return i === -1
      ? { term: l, definition: '' }
      : { term: l.slice(0, i).trim(), definition: l.slice(i + 1).trim() };
  });
}

const toEditable = (v: EditorVersion): EditableVersion => ({
  ...v,
  glossary: v.glossary
    .map((g) => (g.definition ? `${g.term} : ${g.definition}` : g.term))
    .join('\n'),
  visualSupports: v.visualSupports.join('\n'),
  questions: v.questions.join('\n'),
});

export function ResultEditor({
  mode,
  id,
  initial,
}: {
  mode: 'job' | 'saved';
  id: string;
  initial: { title: string; objective: string; versions: EditorVersion[] };
}) {
  const t = useTranslations('differentiate');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const draft = useDraft(`differentiate:${mode}:${id}`, {
    title: initial.title,
    objective: initial.objective,
    versions: initial.versions.map(toEditable),
  });
  const v = draft.value;
  const [selected, setSelected] = useState(0);
  const [printing, setPrinting] = useState<number[]>([]);

  const payload = () => ({
    title: v.title,
    objective: v.objective,
    versions: v.versions.map((x) => ({
      languageLevelId: x.languageLevelId,
      title: x.title,
      text: x.text,
      glossary: parseGlossary(x.glossary).filter((g) => g.term),
      visualSupports: lines(x.visualSupports),
      questions: lines(x.questions),
      teacherNote: x.teacherNote,
    })),
  });

  const saveNew = useAction(saveDifferentiation, {
    onSuccess: ({ itemId }) => {
      draft.clear();
      toast.success(t('savedToLibrary'));
      router.push(`/differentiate/saved/${itemId}`);
    },
  });
  const saveChanges = useAction(updateSavedDifferentiation, {
    successMessage: t('changesSaved'),
    onSuccess: () => draft.clear(),
  });
  const remove = useAction(deleteSavedDifferentiation, {
    successMessage: t('deleted'),
    onSuccess: () => {
      draft.clear();
      router.push('/differentiate');
    },
  });
  const pending = saveNew.pending || saveChanges.pending;

  const save = () =>
    void (mode === 'job' ? saveNew.run(id, payload()) : saveChanges.run(id, payload()));

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
            <Button variant="ghost" size="sm" onClick={() => draft.discard()}>
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
            <Field
              label={t('titleLabel')}
              htmlFor="result-title"
              error={saveNew.fieldError('title') ?? saveChanges.fieldError('title')}
            >
              <Input
                id="result-title"
                value={v.title}
                maxLength={200}
                onChange={(e) => draft.update('title', e.target.value)}
              />
            </Field>
            <Field label={t('objective')} htmlFor="result-objective">
              <Textarea
                id="result-objective"
                value={v.objective}
                maxLength={1000}
                className="min-h-16"
                onChange={(e) => draft.update('objective', e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={pending}>
                {pending
                  ? tCommon('saving')
                  : mode === 'job'
                    ? t('saveToLibrary')
                    : t('saveChanges')}
              </Button>
              <Button variant="secondary" onClick={() => print(v.versions.map((_, i) => i))}>
                <Printer aria-hidden />
                {t('printAll')}
              </Button>
              {mode === 'saved' ? (
                <ConfirmButton
                  label={t('deleteSaved')}
                  message={t('deleteSavedConfirm')}
                  confirmLabel={tCommon('delete')}
                  variant="danger"
                  size="md"
                  onConfirm={() => remove.run(id)}
                />
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* Phones: one level at a time. */}
        <div role="group" aria-label={t('levelTabs')} className="flex flex-wrap gap-2 md:hidden">
          {v.versions.map((x, i) => (
            <Button
              key={x.languageLevelId}
              size="sm"
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
            const error = (field: string) =>
              saveNew.fieldError(`versions.${i}.${field}`) ??
              saveChanges.fieldError(`versions.${i}.${field}`);
            return (
              <Card
                key={x.languageLevelId}
                className={cn(i !== selected && 'hidden md:block')}
                aria-labelledby={`${idp}-level`}
              >
                <CardHeader>
                  <CardTitle id={`${idp}-level`}>{x.levelLabel}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => print([i])}>
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

      {/* Student copies: no level name on the page, only a small neutral number for the
          teacher, so no student sees themselves labelled "Débutant". */}
      <div className="hidden text-black print:block">
        {printing.map((index) => {
          const x = v.versions[index];
          if (!x) return null;
          const glossary = parseGlossary(x.glossary);
          const questions = lines(x.questions);
          return (
            <section key={x.languageLevelId} className="break-after-page space-y-4 font-serif">
              <p className="text-right text-xs text-gray-400">{index + 1}</p>
              <h1 className="text-2xl font-bold">{x.title}</h1>
              <div className="text-lg leading-relaxed whitespace-pre-wrap">{x.text}</div>
              {glossary.length ? (
                <div>
                  <h2 className="text-lg font-bold">{t('glossary')}</h2>
                  <dl className="mt-1 space-y-1">
                    {glossary.map((g) => (
                      <div key={g.term}>
                        <dt className="inline font-bold">{g.term}</dt>
                        {g.definition ? <dd className="inline"> : {g.definition}</dd> : null}
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              {questions.length ? (
                <div>
                  <h2 className="text-lg font-bold">{t('questions')}</h2>
                  <ol className="mt-1 list-decimal space-y-6 pl-6">
                    {questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
