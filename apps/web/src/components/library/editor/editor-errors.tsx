'use client';

import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useErrorText } from '@/hooks/use-action';

/**
 * The save's field errors, for every field of the editor (DECISIONS D-061): keys are editor paths
 * (`title`, `versions.0.content.questions.2.prompt`, `readiness.expectations`), values error keys
 * (`libraryEdit.errors.<key>`, or `errors.<key>` for the shared ones).
 */
const ErrorsContext = createContext<Record<string, string>>({});

export function EditorErrorsProvider({
  errors,
  children,
}: {
  errors: Record<string, string>;
  children: ReactNode;
}) {
  return <ErrorsContext.Provider value={errors}>{children}</ErrorsContext.Provider>;
}

/** Translates an editor error key: the editor's own first, then the app's. */
export function useEditorErrorText() {
  const t = useTranslations('libraryEdit.errors');
  const shared = useErrorText();
  return useCallback(
    (key: string | undefined): string | undefined => {
      if (!key) return undefined;
      if (t.has(key as 'invalid')) return t(key as 'invalid');
      return shared(key) ?? undefined;
    },
    [t, shared],
  );
}

export function useEditorErrors() {
  const errors = useContext(ErrorsContext);
  const text = useEditorErrorText();
  return useMemo(
    () => ({
      /** The message of the error on exactly this field. */
      at: (path: string) => text(errors[path]),
      /** Whether something at or under this path has an error (a question, a version). */
      within: (prefix: string) =>
        Object.keys(errors).some((k) => k === prefix || k.startsWith(`${prefix}.`)),
    }),
    [errors, text],
  );
}

/** A DOM id from an editor path (`versions.0.content.title` → `f-versions-0-content-title`). */
export const fieldId = (path: string) => `f-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
