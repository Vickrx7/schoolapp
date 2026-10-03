'use client';

import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';

export interface PrintVersionChoice {
  id: string;
  number: number;
  /** « Version de base » or the level's name: on screen only, never printed (D-042). */
  label: string;
}

/**
 * The print page's choices (on screen only): the student sheet or the guide and key, which
 * versions, and the legend of the numbers printed on each page (« 1 = Version de base,
 * 2 = Débutant… »), then « Imprimer ». Choices go into the address and the server draws the
 * pages again, so what is printed is always what the server rendered.
 */
export function PrintOptions({
  basePath,
  doc,
  versions,
  selected,
  hasStudentSheet,
  pdf,
}: {
  /** `/library/items/<id>/print`. */
  basePath: string;
  doc: 'student' | 'teacher';
  versions: readonly PrintVersionChoice[];
  selected: readonly string[];
  hasStudentSheet: boolean;
  /** The PDF slot for the same choices. */
  pdf?: ReactNode;
}) {
  const t = useTranslations('libraryItem.print');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [keepOne, setKeepOne] = useState(false);

  const go = (nextDoc: 'student' | 'teacher', ids: readonly string[]) => {
    // Keep the version order whatever order they were ticked in.
    const ordered = versions.filter((v) => ids.includes(v.id)).map((v) => v.id);
    startTransition(() => {
      router.replace(`${basePath}?doc=${nextDoc}&v=${ordered.join(',')}`, { scroll: false });
    });
  };
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) {
        setKeepOne(true);
        return;
      }
      go(
        doc,
        selected.filter((v) => v !== id),
      );
    } else {
      go(doc, [...selected, id]);
    }
    setKeepOne(false);
  };

  return (
    <div className="space-y-4" aria-busy={pending}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t('doc')}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip
            name="doc"
            value="student"
            checked={doc === 'student'}
            disabled={!hasStudentSheet}
            onChange={() => go('student', selected)}
          >
            {t('student')}
          </Chip>
          <Chip
            name="doc"
            value="teacher"
            checked={doc === 'teacher'}
            onChange={() => go('teacher', selected)}
          >
            {t('teacher')}
          </Chip>
        </div>
        <p className="text-sm text-slate-600">
          {doc === 'student' ? t('studentHint') : t('teacherHint')}
        </p>
      </fieldset>

      {versions.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('versions')}</legend>
          <p className="text-sm text-slate-600">{t('legend')}</p>
          <div className="flex flex-wrap gap-2">
            {versions.map((v) => (
              <Chip
                key={v.id}
                type="checkbox"
                name="v"
                value={v.id}
                checked={selected.includes(v.id)}
                onChange={() => toggle(v.id)}
              >
                {t('legendItem', { number: v.number, label: v.label })}
              </Chip>
            ))}
          </div>
          {keepOne ? (
            <p role="alert" className="text-sm text-red-600">
              {t('keepOne')}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()} disabled={pending}>
          <Printer aria-hidden />
          {t('print')}
        </Button>
        {pdf}
      </div>
    </div>
  );
}
