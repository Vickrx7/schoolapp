'use client';

import { useEffect, useMemo } from 'react';
import { referenceFor, reportClientError, type ReportableError } from '@/lib/report-client-error';

/**
 * The reference an error page shows (« Référence : … », DECISIONS D-111), reported once to the
 * server's log with the route template. A server error's reference is its digest, so the same
 * value is rendered on the server and in the browser; an error without one only ever happens in
 * the browser, which makes a random reference.
 */
export function useErrorReference(error: ReportableError): string {
  const reference = useMemo(() => referenceFor(error), [error]);
  useEffect(() => {
    void reportClientError(error, reference);
  }, [error, reference]);
  return reference;
}
