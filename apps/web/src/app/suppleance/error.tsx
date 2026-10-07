'use client';

import { ErrorPanel } from '@/components/app/error-panel';

/** Something failed on a portal page: the plan was not lost; try again or call the office. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-4">
      <ErrorPanel error={error} reset={reset} />
    </div>
  );
}
