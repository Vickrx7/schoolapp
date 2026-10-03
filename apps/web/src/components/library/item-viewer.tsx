'use client';

import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ITEM_TABS, type ItemTab } from './item-tabs';
import { VersionPicker, type VersionChoice } from './version-picker';

/**
 * The item page's versions and tabs (« Pour les élèves », « Guide et corrigé », « Détails »; a
 * type with no student sheet shows « Contenu » and « Détails »).
 * Every document is rendered on the server; this only chooses which one shows, so no content
 * package code reaches the browser. The choice is kept in the address (`?v=…&tab=…`) so a
 * reload or « Retour à la ressource » comes back to it. « Imprimer » prints what is on screen:
 * the chosen version's student sheet, or its guide and key from « Guide et corrigé ».
 */
export function ItemViewer({
  versions,
  initialVersionId,
  initialTab,
  hasStudentSheet,
  student,
  teacher,
  details,
  printLinks,
  versionActions,
  belowPicker,
  actions,
}: {
  versions: readonly VersionChoice[];
  initialVersionId: string;
  initialTab: ItemTab;
  /** Teacher-only types (`lesson_plan`, `teacher_guide`) have no student sheet. */
  hasStudentSheet: boolean;
  /** Per version id. */
  student: Record<string, ReactNode>;
  teacher: Record<string, ReactNode>;
  details: ReactNode;
  /** Per version id: the print page for its student sheet and for its guide and key. */
  printLinks: Record<string, { student: string; teacher: string }>;
  /** Per version id: actions that depend on the version (the PDF slot). */
  versionActions: Record<string, ReactNode>;
  /** Under the version picker (« Créer les versions manquantes avec l’IA »). */
  belowPicker?: ReactNode;
  /** Actions that do not depend on the version (« Ajouter à ma planification »). */
  actions?: ReactNode;
}) {
  const t = useTranslations('libraryItem');
  const id = useId();
  const [chosenVersion, setVersionId] = useState(initialVersionId);
  // A version can disappear (removed in the editor, then the page refreshed): fall back to the
  // first one.
  const versionId = versions.some((v) => v.id === chosenVersion)
    ? chosenVersion
    : (versions[0]?.id ?? '');
  // A type with no student sheet has no « Pour les élèves » tab; its document is « Contenu ».
  const tabs: readonly ItemTab[] = hasStudentSheet
    ? ITEM_TABS
    : ITEM_TABS.filter((x) => x !== 'student');
  const [chosenTab, setTab] = useState<ItemTab>(initialTab);
  const tab: ItemTab = tabs.includes(chosenTab) ? chosenTab : tabs[0]!;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const remember = (v: string, x: ItemTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('v', v);
    url.searchParams.set('tab', x);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  const chooseVersion = (v: string) => {
    setVersionId(v);
    remember(v, tab);
  };
  const chooseTab = (x: ItemTab) => {
    setTab(x);
    remember(versionId, x);
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (index + last) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    chooseTab(tabs[next]!);
    refs.current[next]?.focus();
  };

  const printDoc = tab === 'teacher' || !hasStudentSheet ? 'teacher' : 'student';
  const printLink = printLinks[versionId]?.[printDoc];

  return (
    <div className="space-y-4">
      {versions.length > 1 ? (
        <VersionPicker versions={versions} selected={versionId} onSelect={chooseVersion} />
      ) : null}
      {belowPicker}

      <div role="group" aria-label={t('actions.label')} className="flex flex-wrap gap-2">
        {printLink ? (
          <Button asChild variant="secondary">
            <Link href={printLink}>
              <Printer aria-hidden />
              {t('actions.print')}
            </Link>
          </Button>
        ) : null}
        {versionActions[versionId]}
        {actions}
      </div>

      <div
        role="tablist"
        aria-label={t('tabs.label')}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 md:mx-0 md:px-0"
      >
        {tabs.map((x, i) => {
          const active = x === tab;
          return (
            <button
              key={x}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${x}`}
              aria-selected={active}
              aria-controls={`${id}-panel-${x}`}
              tabIndex={active ? 0 : -1}
              onClick={() => chooseTab(x)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-slate-600 hover:text-slate-900',
                active && 'border-brand-600 text-brand-700',
              )}
            >
              {x === 'teacher' && !hasStudentSheet ? t('tabs.content') : t(`tabs.${x}`)}
            </button>
          );
        })}
      </div>

      {tabs.map((x) => (
        <div
          key={x}
          role="tabpanel"
          id={`${id}-panel-${x}`}
          aria-labelledby={`${id}-tab-${x}`}
          hidden={x !== tab}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6"
        >
          {x !== tab
            ? null
            : x === 'student'
              ? (student[versionId] ?? null)
              : x === 'teacher'
                ? (teacher[versionId] ?? null)
                : details}
        </div>
      ))}
    </div>
  );
}
