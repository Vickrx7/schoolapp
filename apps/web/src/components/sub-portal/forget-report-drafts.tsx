'use client';

import { useEffect } from 'react';
import { draftStorage, removeDrafts } from '@/hooks/draft-storage';

/**
 * Removes the report copies kept in this tab (D-054): at « Terminer ma journée » and when the
 * access has ended, so nothing of the day stays in a browser the substitute leaves behind.
 */
export function forgetReportDrafts() {
  removeDrafts((key) => key.startsWith('sub-report:'), draftStorage('session'));
}

/** Runs forgetReportDrafts() once the page is shown. */
export function ForgetReportDrafts() {
  useEffect(() => {
    forgetReportDrafts();
  }, []);
  return null;
}
