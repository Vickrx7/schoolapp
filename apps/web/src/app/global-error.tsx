'use client';

import { useErrorReference } from '@/hooks/use-error-reference';
import './globals.css';

/**
 * The last resort, when the root layout itself failed (DECISIONS D-111): it replaces the whole
 * page, without the translations (they come from the root layout), so it speaks both languages.
 * The reference matches the server's log line; « Signaler ce problème » opens « Commentaires »
 * with it filled in (`/commentaires?ref=…`, D-116), a page of its own since nothing of the app's
 * shell is left here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reference = useErrorReference(error);
  return (
    <html lang="fr-CA">
      <body className="bg-slate-50">
        <title>Erreur · Error</title>
        <main className="mx-auto max-w-xl space-y-4 px-4 py-16 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Oups, un problème est survenu.{' '}
            <span lang="en-CA" className="block text-base font-normal text-slate-600">
              Oops, something went wrong.
            </span>
          </h1>
          <p className="text-slate-700">
            Une erreur inattendue s’est produite. Réessayez dans un instant.{' '}
            <span lang="en-CA" className="block text-slate-600">
              Something unexpected happened. Please try again in a moment.
            </span>
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-slate-900 px-5 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <span>
              Réessayer · <span lang="en-CA">Try again</span>
            </span>
          </button>
          <p className="text-xs text-slate-500" data-testid="error-reference">
            Référence : {reference} · <span lang="en-CA">Reference: {reference}</span>
          </p>
          {/* A plain link: the app's router may be what failed. */}
          <a
            href={`/commentaires?ref=${encodeURIComponent(reference)}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-slate-900 underline underline-offset-2"
          >
            <span>
              Signaler ce problème · <span lang="en-CA">Report this problem</span>
            </span>
          </a>
        </main>
      </body>
    </html>
  );
}
