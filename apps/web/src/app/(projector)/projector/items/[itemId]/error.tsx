'use client';

import { ErrorPanel } from '@/components/app/error-panel';

/** The presentation could not be built: nothing was lost (it writes nothing); try again. */
export default function PresenterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <ErrorPanel error={error} reset={reset} />
    </div>
  );
}
