'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/lib/action-result';

const KNOWN_ERRORS = new Set([
  'forbidden',
  'duplicate',
  'inUse',
  'invalid',
  'featureDisabled',
  'notFound',
  'unexpected',
  'network',
  'required',
  'tooLong',
  'tooMany',
  'invalidTime',
  'invalidDate',
  'atLeastOneGrade',
  'atLeastOneDay',
  'endBeforeStart',
  'subjectRequired',
  'notAName',
  'alertsKeyMissing',
]);

/** Translates an error key from a server action; unknown keys fall back to a generic message. */
export function useErrorText() {
  const t = useTranslations('errors');
  return useCallback(
    (key: string | null | undefined) =>
      key ? t((KNOWN_ERRORS.has(key) ? key : 'unexpected') as 'unexpected') : null,
    [t],
  );
}

/**
 * Runs a server action in a transition and tracks pending state and errors. Network
 * failures are reported as errors instead of throwing, so forms never lose what was typed.
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<ActionResult<T>>,
  options: { successMessage?: string; onSuccess?: (data: T) => void } = {},
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorText = useErrorText();

  const run = useCallback(
    (...args: Args) =>
      new Promise<ActionResult<T> | null>((resolve) => {
        setError(null);
        setFieldErrors({});
        startTransition(async () => {
          try {
            const result = await action(...args);
            if (result.ok) {
              if (options.successMessage) toast.success(options.successMessage);
              options.onSuccess?.(result.data);
            } else {
              setError(result.error);
              setFieldErrors(result.fieldErrors ?? {});
              if (!result.fieldErrors) toast.error(errorText(result.error));
            }
            resolve(result);
          } catch {
            setError('network');
            toast.error(errorText('network'));
            resolve(null);
          }
        });
      }),
    [action, options, errorText],
  );

  const fieldError = (name: string) => errorText(fieldErrors[name]) ?? undefined;

  return { run, pending, error, errorText: errorText(error), fieldError };
}
