import { GitFork } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { LineageMessage, LineageMessageKey, LineageView } from '@/server/library/lineage-view';

/** A translator of the `libraryGrowth` namespace, as `useTranslations` or `getTranslations` give. */
export type LineageTranslator = (
  key: LineageMessageKey,
  values?: { title?: string; name?: string; school?: string },
) => string;

/** One part of the credit line, in the interface language. */
export function lineageMessage(t: LineageTranslator, message: LineageMessage): string {
  return t(message.key, message.values);
}

/** The whole credit line as text (« Adaptée de « … » (Conseil scolaire) »), e.g. for the share dialog. */
export function lineageText(t: LineageTranslator, view: LineageView): string {
  return [lineageMessage(t, view.basedOn), view.credit ? lineageMessage(t, view.credit) : null]
    .filter(Boolean)
    .join(' ');
}

/**
 * The credit line of an adaptation (DECISIONS D-092): « Adaptée de « Le huard, oiseau des lacs »
 * (Conseil scolaire) », the original's title a link to it when the reader can use it, else only
 * the title copied at adaptation time and « (ressource d’origine non disponible) ». Names are
 * read live and only for an original the reader can use (`public.library_item_lineage`).
 */
export function Lineage({ view }: { view: LineageView }) {
  const t = useTranslations('libraryGrowth');
  const text = (message: LineageMessage) =>
    lineageMessage((key, values) => t(key, values as never), message);
  const basedOn = text(view.basedOn);
  return (
    <p className="flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-700">
      <GitFork className="size-4 shrink-0 text-slate-500" aria-hidden />
      {view.href ? (
        <Link
          href={view.href}
          className="font-medium break-words text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          {basedOn}
        </Link>
      ) : (
        <span className="break-words">{basedOn}</span>
      )}
      {view.credit ? <span className="break-words">{text(view.credit)}</span> : null}
    </p>
  );
}
