'use client';

import type { BlockedKind, Segment } from '@lynx/ai/privacy';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import type { ExistingItem } from '@/server/actions/library-ai';

/**
 * The text sent, with each replaced name highlighted. It scrolls when long, so it takes the focus
 * to be read with the keyboard too.
 */
export function SentText({ segments }: { segments: Segment[] }) {
  return (
    <pre
      className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800"
      tabIndex={0}
    >
      {segments.map((s, i) =>
        s.placeholder ? (
          <mark key={i} className="rounded bg-brand-100 px-1 font-medium text-brand-800">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  );
}

/** Personal details found: the request stays blocked until they are removed. */
export function BlockedDetails({ blocked }: { blocked: { kind: BlockedKind; match: string }[] }) {
  const t = useTranslations('libraryAi');
  const tDiff = useTranslations('differentiate');
  if (!blocked.length) return null;
  return (
    <Notice tone="danger" className="space-y-2">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4" aria-hidden />
        {t('blockedTitle')}
      </p>
      <p>{t('blockedIntro')}</p>
      <ul className="list-disc space-y-1 pl-5">
        {blocked.map((b, i) => (
          <li key={i}>
            {tDiff.rich('blockedItem', {
              kind: tDiff(`blocked.${b.kind}`),
              match: b.match,
              code: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/**
 * « Vérifier avant d’envoyer » for « Créer avec l’IA » (D-038, D-072): exactly the text that would
 * be sent, names replaced and highlighted, the personal details that block it, and the
 * board-approved resources that already fit, before anything is spent.
 */
export function GeneratePreview({
  preview,
  longer,
  sending,
  disabled,
  onSend,
  onEdit,
}: {
  preview: {
    message: Segment[];
    replaced: number;
    blocked: { kind: BlockedKind; match: string }[];
    existing: ExistingItem[];
  };
  /** Versions per level were asked for: it takes longer and costs more. */
  longer: boolean;
  sending: boolean;
  disabled: boolean;
  onSend: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations('libraryAi');
  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle>{t('previewTitle')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {preview.existing.length ? (
          <Notice tone="info" className="space-y-2">
            <p className="font-medium">{t('existingTitle')}</p>
            <ul className="list-disc space-y-1 pl-5">
              {preview.existing.map((item) => (
                <li key={item.id}>
                  <Link href={`/library/items/${item.id}`} className="text-brand-700 underline">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-sm">{t('existingHint')}</p>
          </Notice>
        ) : null}
        <p className="text-sm text-slate-600">{t('previewIntro')}</p>
        <BlockedDetails blocked={preview.blocked} />
        <SentText segments={preview.message} />
        <p className="text-sm font-medium text-slate-700">
          {t('replacedCount', { count: preview.replaced })}
        </p>
        <p className="text-sm text-slate-600">{t('previewCheck')}</p>
        {longer ? <p className="text-sm text-slate-600">{t('longer')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSend} disabled={sending || preview.blocked.length > 0 || disabled}>
            {sending ? t('sending') : t('send')}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            {t('edit')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
