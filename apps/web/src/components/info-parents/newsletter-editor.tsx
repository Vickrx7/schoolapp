'use client';

import {
  fixTypography,
  itemsNeedingEnglish,
  newsletterItemId,
  newsletterPlainText,
  newsletterWordNotes,
  NEWSLETTER_LIMITS,
  typedItem,
  type NewsletterContent,
  type NewsletterSectionKey,
  type NewsletterTextLanguage,
} from '@lynx/domain';
import { Copy, Printer, RefreshCw, Type } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { copyText } from '@/components/report-comments/copy';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Label, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { newsletterDraftKey } from '@/hooks/draft-storage';
import { useDraft } from '@/hooks/use-draft';
import { openAsNewDocument } from '@/lib/new-document';
import { markNewsletterSent, refillNewsletter, saveNewsletter } from '@/server/actions/newsletters';
import type { NewsletterNames } from '@/server/newsletter/names';
import { CheckDialog, needsCheck } from './check-dialog';
import { DeleteNewsletterButton } from './delete-button';
import { SectionEditor } from './section-editor';

export interface NewsletterEditorProps {
  userId: string;
  classId: string;
  id: string;
  /** The week's Monday (the PDF's address). */
  weekOf: string;
  /** « 5 octobre », for « Supprimer le message de la semaine du … ». */
  weekLabel: string;
  status: 'draft' | 'sent';
  /** « 9 octobre » when sent. */
  sentLabel: string | null;
  revision: number;
  content: NewsletterContent;
  names: NewsletterNames;
  /** The header (school, class, week) in each language: shown and copied, never stored. */
  header: { fr: string; en: string };
  headings: { fr: Record<NewsletterSectionKey, string>; en: Record<NewsletterSectionKey, string> };
  /** The options « Préremplir à nouveau » offers (as « Préparer le message »). */
  options: { colleagues: boolean; guides: boolean };
}

/**
 * The week's message (DECISIONS D-136 to D-138): the header and the signature, the notice, every
 * section's paragraphs in French and English, « Préremplir à nouveau », « Corriger la
 * typographie », « Copier », « Imprimer (PDF) » (D-141) and « Marquer comme envoyé ». The content
 * is a device draft until it is saved (D-035); a save is refused when a colleague saved first
 * (`newsletterConflict`): the page then reloads the newer version and offers « Récupérer mes
 * modifications ». Copying, printing and marking sent wait for a save, then check the names
 * (« Des élèves sont nommés »); the PDF is the saved message, opened in the browser to print or
 * save (a plain navigation: nothing is prefetched).
 */
export function NewsletterEditor(props: NewsletterEditorProps) {
  const router = useRouter();
  // Remounted on the server's newer version after a conflict or « Préremplir à nouveau ».
  const [generation, setGeneration] = useState(0);
  const awaiting = useRef<number | null>(null);
  useEffect(() => {
    if (awaiting.current !== null && props.revision !== awaiting.current) {
      awaiting.current = null;
      setGeneration((g) => g + 1);
    }
  }, [props.revision]);
  return (
    <EditorBody
      key={generation}
      {...props}
      reload={{
        expect: (revision) => {
          awaiting.current = revision;
        },
        cancel: () => {
          awaiting.current = null;
        },
        now: (revision) => {
          awaiting.current = revision;
          router.refresh();
        },
      }}
    />
  );
}

type Pending =
  | { kind: 'copy'; lang: NewsletterTextLanguage }
  | { kind: 'pdf'; lang: NewsletterTextLanguage }
  | { kind: 'sent' };

/** Paragraphs that will appear in French in what is shared (none for the French or « envoyé »). */
const missingFor = (next: Pending | null, content: NewsletterContent) =>
  next && next.kind !== 'sent' && next.lang !== 'fr' ? itemsNeedingEnglish(content).length : 0;

const LANGUAGES = [
  ['fr', 'copyFr', 'fr'],
  ['en', 'copyEn', 'en'],
  ['both', 'copyBoth', 'both'],
] as const;

function EditorBody({
  userId,
  classId,
  id,
  weekOf,
  weekLabel,
  status,
  sentLabel,
  revision: initialRevision,
  content: initialContent,
  names: initialNames,
  header,
  headings,
  options,
  reload,
}: NewsletterEditorProps & {
  reload: {
    expect: (revision: number) => void;
    cancel: () => void;
    now: (revision: number) => void;
  };
}) {
  const t = useTranslations('newsletter');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const signatureId = useId();
  const [revision, setRevision] = useState(initialRevision);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initialContent));
  const [names, setNames] = useState(initialNames);
  const draft = useDraft<NewsletterContent>(newsletterDraftKey(userId, id), initialContent, {
    version: String(revision),
  });
  const content = draft.value;
  const dirty = JSON.stringify(content) !== savedJson;
  const readOnly = status === 'sent';
  const total = content.sections.reduce((n, s) => n + s.items.length, 0);
  const [wordNotes, setWordNotes] = useState<string[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) document.getElementById(`${focusId}-fr`)?.focus();
  }, [focusId]);
  // Interactive (tests wait for it: a tap before hydration is lost).
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after hydration
  useEffect(() => setReady(true), []);

  const save = useAction(saveNewsletter, {
    onSuccess: (data) => {
      setRevision(data.revision);
      setNames(data.names);
      draft.clear();
    },
  });
  const runSave = async () => {
    const sent = content;
    const result = await save.run(id, revision, sent);
    if (result?.ok) setSavedJson(JSON.stringify(sent));
    else if (result && !result.ok && result.error === 'newsletterConflict') reload.now(revision);
  };

  const refill = useAction(refillNewsletter);
  const [refillOptions, setRefillOptions] = useState(() => ({
    colleagues: false,
    faith: !initialContent.sections.find((s) => s.key === 'faith')?.off,
    guides: options.guides && !initialContent.sections.find((s) => s.key === 'atHome')?.off,
  }));

  const mark = useAction(markNewsletterSent);

  const share = (next: Pending) => {
    if (needsCheck(names, missingFor(next, content))) setPending(next);
    else void act(next);
  };
  const act = async (next: Pending) => {
    setPending(null);
    if (next.kind === 'pdf') {
      // The saved message, rendered by the route: the browser opens it to print or save.
      openAsNewDocument(`/classes/${classId}/info-parents/${weekOf}/pdf?lang=${next.lang}`);
      return;
    }
    if (next.kind === 'sent') {
      const result = await mark.run(id, true);
      if (result?.ok) toast.success(t('editor.markedSent'));
      return;
    }
    const text = newsletterPlainText(content, { lang: next.lang, header, headings });
    if (await copyText(text)) toast.success(t('editor.copied'));
    else setFallback(text);
  };

  const shareBlocked = dirty || save.pending;

  return (
    <div className="space-y-5 pb-4" data-testid="newsletter-editor" data-ready={ready}>
      {draft.restored ? (
        <Notice className="flex flex-wrap items-center justify-between gap-2">
          <span>{tCommon('draftRestored')}</span>
          <Button variant="ghost" onClick={() => draft.discard()}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      {draft.offered ? (
        <Notice tone="warning" className="space-y-2">
          <p>{t('editor.draftOlder')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => draft.recover()}>
              {t('editor.recoverDraft')}
            </Button>
            <Button variant="ghost" onClick={() => draft.discard()}>
              {tCommon('discardDraft')}
            </Button>
          </div>
        </Notice>
      ) : null}

      <Notice tone="warning" data-testid="newsletter-notice">
        {t('editor.notice')}
      </Notice>
      {readOnly && sentLabel ? (
        <Notice tone="success">{t('editor.sent', { date: sentLabel })}</Notice>
      ) : null}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-slate-700">{t('editor.header')}</p>
          <p className="mt-1 font-medium text-slate-900" lang="fr" data-testid="newsletter-header">
            {header.fr}
          </p>
          <p className="text-slate-700" lang="en">
            {header.en}
          </p>
          <p className="mt-1 text-sm text-slate-600">{t('editor.headerHint')}</p>
        </div>
        <Field label={t('editor.signature')} htmlFor={signatureId} className="max-w-sm">
          <Input
            id={signatureId}
            value={content.signature}
            maxLength={NEWSLETTER_LIMITS.signature}
            readOnly={readOnly}
            onChange={(e) => draft.update('signature', e.target.value)}
          />
        </Field>
      </div>

      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <RefillButton
            disabled={dirty || refill.pending || save.pending}
            options={options}
            values={refillOptions}
            onValues={setRefillOptions}
            onConfirm={async () => {
              reload.expect(revision);
              const result = await refill.run(id, revision, refillOptions);
              if (result?.ok) {
                draft.clear();
                toast.success(t('editor.refilled'));
                router.refresh();
              } else {
                reload.cancel();
                if (result && !result.ok && result.error === 'newsletterConflict')
                  reload.now(revision);
              }
            }}
          />
          <Button
            variant="secondary"
            onClick={() => {
              const fixed = fixTypography(content);
              const words = [...new Set(newsletterWordNotes(fixed).map((n) => n.word))];
              setWordNotes(words.length ? words : null);
              if (JSON.stringify(fixed) === JSON.stringify(content)) {
                toast.success(t('editor.typographyNone'));
              } else {
                draft.setValue(fixed);
                toast.success(t('editor.typographyDone'));
              }
            }}
          >
            <Type aria-hidden />
            {t('editor.typography')}
          </Button>
        </div>
      )}
      {wordNotes ? (
        <Notice tone="warning">
          {t('editor.wordNotes', { words: wordNotes.map((w) => `«\u00a0${w}\u00a0»`).join(', ') })}
        </Notice>
      ) : null}

      <div className="space-y-4">
        {content.sections.map((section, s) => (
          <SectionEditor
            key={section.key}
            section={section}
            heading={{ fr: headings.fr[section.key], en: headings.en[section.key] }}
            readOnly={readOnly}
            canAdd={total < NEWSLETTER_LIMITS.items}
            onChange={(next) =>
              draft.setValue((prev) => ({
                ...prev,
                sections: prev.sections.map((x, i) => (i === s ? next : x)),
              }))
            }
            onAdd={() => {
              const item = typedItem(newsletterItemId());
              setFocusId(item.id);
              draft.setValue((prev) => ({
                ...prev,
                sections: prev.sections.map((x, i) =>
                  i === s ? { ...x, items: [...x.items, item] } : x,
                ),
              }));
            }}
          />
        ))}
        {total >= NEWSLETTER_LIMITS.items ? (
          <p className="text-sm text-slate-600">{t('editor.tooMany')}</p>
        ) : null}
      </div>

      <section
        aria-labelledby={`${signatureId}-share`}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h3 id={`${signatureId}-share`} className="font-semibold text-slate-900">
          {t('editor.share')}
        </h3>
        {shareBlocked ? <p className="text-sm text-slate-600">{t('editor.saveFirst')}</p> : null}
        <div role="group" aria-label={t('editor.copy')} className="flex flex-wrap gap-2">
          {LANGUAGES.map(([lang, key]) => (
            <Button
              key={lang}
              variant="secondary"
              disabled={shareBlocked}
              // « Copy the English » is written in English in the French interface.
              lang={lang === 'en' && locale.startsWith('fr') ? 'en' : undefined}
              onClick={() => share({ kind: 'copy', lang })}
            >
              <Copy aria-hidden />
              {t(`editor.${key}`)}
            </Button>
          ))}
        </div>
        <div role="group" aria-label={t('pdf.group')} className="flex flex-wrap gap-2">
          {LANGUAGES.map(([lang, , key]) => (
            <Button
              key={lang}
              variant="secondary"
              disabled={shareBlocked}
              // « Print the English (PDF) » too is written in English in the French interface.
              lang={lang === 'en' && locale.startsWith('fr') ? 'en' : undefined}
              onClick={() => share({ kind: 'pdf', lang })}
            >
              <Printer aria-hidden />
              {t(`pdf.${key}`)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {readOnly ? (
            <Button
              variant="secondary"
              disabled={mark.pending}
              onClick={async () => {
                const result = await mark.run(id, false);
                if (result?.ok) toast.success(t('editor.markedDraft'));
              }}
            >
              {t('editor.markDraft')}
            </Button>
          ) : (
            <Button
              variant="success"
              disabled={shareBlocked || mark.pending}
              onClick={() => share({ kind: 'sent' })}
            >
              {t('editor.markSent')}
            </Button>
          )}
          <DeleteNewsletterButton
            classId={classId}
            id={id}
            weekLabel={weekLabel}
            onDeleted={() => draft.clear()}
          />
        </div>
      </section>

      {readOnly ? null : (
        <div
          className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-4 md:mx-0 md:rounded-xl md:border"
          data-testid="newsletter-save-bar"
        >
          <p className="text-sm text-slate-700" role="status" aria-live="polite">
            {save.pending ? tCommon('saving') : dirty ? t('editor.unsaved') : t('editor.saved')}
          </p>
          <Button disabled={!dirty || save.pending} onClick={() => void runSave()}>
            {save.pending ? tCommon('saving') : t('editor.save')}
          </Button>
        </div>
      )}

      <CheckDialog
        open={pending !== null}
        names={names}
        missingEnglish={missingFor(pending, content)}
        onClose={() => setPending(null)}
        onContinue={() => pending && void act(pending)}
      />

      <Dialog open={fallback !== null} onOpenChange={(open) => (open ? null : setFallback(null))}>
        <DialogContent title={t('editor.copyText')} closeLabel={tCommon('close')}>
          <p className="mb-3 text-sm text-slate-700">{t('editor.copyFailed')}</p>
          <Label htmlFor={`${signatureId}-text`} className="sr-only">
            {t('editor.copyText')}
          </Label>
          <Textarea
            id={`${signatureId}-text`}
            readOnly
            rows={12}
            value={fallback ?? ''}
            onFocus={(e) => e.currentTarget.select()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** « Préremplir à nouveau », asking first, with « Préparer le message »'s options. */
function RefillButton({
  disabled,
  options,
  values,
  onValues,
  onConfirm,
}: {
  disabled: boolean;
  options: { colleagues: boolean; guides: boolean };
  values: { colleagues: boolean; faith: boolean; guides: boolean };
  onValues: (values: { colleagues: boolean; faith: boolean; guides: boolean }) => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations('newsletter');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = (key: 'colleagues' | 'faith' | 'guides', label: string) => (
    <label className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
      <input
        type="checkbox"
        className="size-5 accent-brand-600"
        checked={values[key]}
        onChange={(e) => onValues({ ...values, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={disabled}>
          <RefreshCw aria-hidden />
          {t('editor.refill')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('editor.refill')} closeLabel={tCommon('close')}>
        <p className="text-slate-700">{t('editor.refillMessage')}</p>
        <div className="mt-3">
          {options.colleagues ? box('colleagues', t('prepare.colleagues')) : null}
          {box('faith', t('prepare.faith'))}
          {options.guides ? box('guides', t('prepare.guides')) : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('editor.refillConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
