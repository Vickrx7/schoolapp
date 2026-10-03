'use client';

import {
  NEWSLETTER_LIMITS,
  withTeacherEnglish,
  type NewsletterItem,
  type NewsletterSection,
} from '@lynx/domain';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ItemRow } from './item-row';

/**
 * A section of the message (DECISIONS D-137): its heading in both languages, its paragraphs, then
 * « Ajouter un paragraphe » and « Retirer la section » (kept, not copied) or « Remettre la
 * section ». On phones, « Français · English » picks the language its paragraphs show.
 */
export function SectionEditor({
  section,
  heading,
  readOnly,
  canAdd,
  onChange,
  onAdd,
}: {
  section: NewsletterSection;
  heading: { fr: string; en: string };
  readOnly: boolean;
  /** False once the message holds 60 paragraphs. */
  canAdd: boolean;
  onChange: (section: NewsletterSection) => void;
  onAdd: () => void;
}) {
  const t = useTranslations('newsletter.editor');
  const headingId = useId();
  const [lang, setLang] = useState<'fr' | 'en'>('fr');
  const items = section.items;
  const setItems = (next: NewsletterItem[]) => onChange({ ...section, items: next });
  const full = items.length >= NEWSLETTER_LIMITS.itemsPerSection;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4',
        section.off && 'bg-white',
      )}
      data-testid={`newsletter-section-${section.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="font-semibold text-slate-900">
          <span lang="fr">{heading.fr}</span>
          <span className="font-normal text-slate-600" lang="en">
            {' · '}
            {heading.en}
          </span>
        </h3>
        {readOnly ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => onChange({ ...section, off: !section.off })}
          >
            {section.off ? t('restoreSection') : t('removeSection')}
          </Button>
        )}
      </div>

      {section.off ? (
        <p className="text-sm text-slate-600">{t('sectionOff')}</p>
      ) : (
        <>
          {items.length > 0 ? (
            <div
              role="group"
              aria-label={t('languages')}
              className="flex gap-2 md:hidden"
              data-testid="language-tabs"
            >
              {(['fr', 'en'] as const).map((l) => (
                <Button
                  key={l}
                  size="sm"
                  className="min-h-11 flex-1"
                  variant={lang === l ? 'primary' : 'secondary'}
                  aria-pressed={lang === l}
                  lang={l}
                  onClick={() => setLang(l)}
                >
                  {l === 'fr' ? t('frenchLabel') : t('englishLabel')}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('sectionEmpty')}</p>
          )}
          {items.length > 0 ? (
            <ol className="space-y-2">
              {items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  count={items.length}
                  lang={lang}
                  readOnly={readOnly}
                  onFrench={(fr) =>
                    setItems(items.map((i) => (i.id === item.id ? { ...i, fr } : i)))
                  }
                  onEnglish={(en) =>
                    setItems(items.map((i) => (i.id === item.id ? withTeacherEnglish(i, en) : i)))
                  }
                  onMove={(delta) => {
                    const next = [...items];
                    const [moved] = next.splice(index, 1);
                    next.splice(index + delta, 0, moved!);
                    setItems(next);
                  }}
                  onRemove={() => setItems(items.filter((i) => i.id !== item.id))}
                />
              ))}
            </ol>
          ) : null}
          {readOnly ? null : full ? (
            <p className="text-sm text-slate-600">{t('sectionFull')}</p>
          ) : (
            <Button variant="secondary" disabled={!canAdd} onClick={onAdd}>
              <Plus aria-hidden />
              {t('add')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
