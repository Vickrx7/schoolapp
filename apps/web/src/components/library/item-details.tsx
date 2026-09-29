import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/card';
import type { LibraryItemView } from '@/server/library/view-model';
import { PackProvenanceSlot } from './slots/pack-provenance-slot';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 text-slate-900 sm:mt-0">{children}</dd>
    </div>
  );
}

/**
 * « Détails »: grades, subject, attentes (« À vérifier » while unverified, D-030), duration,
 * materials, formats, tags and keywords, the faith link, sharing and provenance, e.g.
 * « Préparée avec l’IA (consigne library_item/v1, modèle claude-opus-5-5) · Approuvée le 12 oct.
 * 2026 · Utilisée dans 3 unités ». Staff-typed text is shown as typed.
 */
export function ItemDetails({ item }: { item: LibraryItemView }) {
  const t = useTranslations('libraryItem');
  const tc = useTranslations('libraryCommon');
  const format = useFormatter();
  const date = (instant: string) =>
    format.dateTime(new Date(instant), { day: 'numeric', month: 'short', year: 'numeric' });
  const none = <span className="text-slate-600">{t('details.none')}</span>;
  const formats = (['printable', 'projectable', 'interactive'] as const).filter(
    (f) => item.formats[f],
  );
  const keywords = item.keywords?.trim();
  const faithShown =
    item.faith.requiresReview || item.faith.content || Boolean(item.faith.connection?.trim());

  const provenance = [
    item.boardOwn
      ? t('provenance.board')
      : item.authorName
        ? t('provenance.author', { name: item.authorName })
        : null,
    item.source === 'ai_generated'
      ? item.provenance.promptVersion && item.provenance.model
        ? t('provenance.aiDetails', {
            prompt: item.provenance.aiFeature
              ? `${item.provenance.aiFeature}/${item.provenance.promptVersion}`
              : item.provenance.promptVersion,
            model: item.provenance.model,
          })
        : t('provenance.ai')
      : null,
    item.provenance.packTitle && item.provenance.packVersion
      ? t('provenance.pack', {
          title: item.provenance.packTitle,
          version: item.provenance.packVersion,
        })
      : null,
    item.provenance.approvedAt
      ? t('provenance.approved', { date: date(item.provenance.approvedAt) })
      : null,
    t('provenance.updated', { date: date(item.provenance.updatedAt) }),
    t('usage', { count: item.provenance.usageCount }),
    item.licence ? t('provenance.licence', { licence: item.licence }) : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <dl>
      {item.summary ? (
        <Row label={t('details.summary')}>
          <p className="whitespace-pre-line">{item.summary}</p>
        </Row>
      ) : null}
      <Row label={t('details.grades')}>
        {item.grades.length ? item.grades.map((g) => g.label).join(', ') : none}
      </Row>
      <Row label={t('details.subject')}>{item.subject?.label ?? none}</Row>
      <Row label={t('details.expectations')}>
        {item.expectations.length ? (
          <ul className="space-y-2">
            {item.expectations.map((e) => (
              <li key={e.id}>
                <span className="block text-xs text-slate-600">
                  {tc(`expectationKinds.${e.kind}`)}
                </span>
                <span className="font-semibold">{e.code}</span> — {e.text}{' '}
                {e.verified ? null : <Badge tone="warning">{tc('badges.toVerify')}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-600">{t('details.noExpectations')}</span>
        )}
      </Row>
      <Row label={t('details.duration')}>
        {item.durationMinutes ? tc('duration.minutes', { count: item.durationMinutes }) : none}
      </Row>
      <Row label={t('details.materials')}>
        {item.materials ? <p className="whitespace-pre-line">{item.materials}</p> : none}
      </Row>
      <Row label={t('details.formats')}>
        {formats.length ? formats.map((f) => tc(`formats.${f}`)).join(' · ') : none}
      </Row>
      <Row label={t('details.subFriendly')}>
        {item.subFriendly ? t('details.subFriendlyYes') : t('details.no')}
      </Row>
      <Row label={t('details.tags')}>
        {item.tags.length || keywords ? (
          <div className="space-y-1">
            {item.tags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <li key={tag.id}>
                    <Badge>{tag.label}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            {keywords ? <p className="text-sm">{keywords}</p> : null}
          </div>
        ) : (
          none
        )}
      </Row>
      {faithShown ? (
        <Row label={t('details.faith')}>
          <div className="space-y-1">
            {item.faith.content ? <p>{t('details.faithContent')}</p> : null}
            {item.faith.connection?.trim() ? (
              <p className="whitespace-pre-line">
                {t('details.faithLink', { text: item.faith.connection.trim() })}
              </p>
            ) : null}
            {item.faith.connection?.trim() && item.faith.onStudentSheet ? (
              <p className="text-sm text-slate-600">{t('details.faithOnSheet')}</p>
            ) : null}
            {item.faith.requiresReview ? (
              <p className="text-sm text-slate-600">
                {item.faith.reviewed ? t('details.faithReviewed') : t('details.faithPending')}
              </p>
            ) : null}
          </div>
        </Row>
      ) : null}
      <Row label={t('details.sharing')}>{tc(`scope.${item.shareScope}`)}</Row>
      <Row label={t('details.provenance')}>
        <ul className="space-y-0.5">
          {provenance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/* A content pack's declared publisher, import date and fingerprint (Phase 5, D-100). */}
        <PackProvenanceSlot item={item} />
      </Row>
    </dl>
  );
}
