'use client';

import { ErrorPanel } from '@/components/app/error-panel';

/**
 * The projector could not load: the session is on the server, so nothing is lost; try again
 * (« Reprendre la projection » on the class tab works too).
 */
export default function ProjectorSessionError({
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
