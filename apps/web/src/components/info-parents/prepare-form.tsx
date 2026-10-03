'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { createNewsletter } from '@/server/actions/newsletters';

/**
 * « Préparer le message » (DECISIONS D-137): the week's first draft from the class's own data,
 * with the colleagues' subjects (off; only when colleagues teach blocks of the class), a faith
 * moment (on, **Assumption**) and tips from the family guides (on; Library module only). Nothing
 * is sent: the editor opens on the draft.
 */
export function PrepareForm({
  classId,
  weekOf,
  colleagues,
  guides,
}: {
  classId: string;
  weekOf: string;
  /** Colleagues teach blocks of the class (`isTeachersBlock`). */
  colleagues: boolean;
  /** The school has the Library module. */
  guides: boolean;
}) {
  const t = useTranslations('newsletter.prepare');
  const router = useRouter();
  const [values, setValues] = useState({ colleagues: false, faith: true, guides });
  const create = useAction(createNewsletter, { onSuccess: () => router.refresh() });
  // A tap before the page is interactive would reload it: the button waits for the page.
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after hydration
  useEffect(() => setReady(true), []);
  const box = (key: keyof typeof values, label: string) => (
    <label className="flex min-h-11 items-center gap-3 text-slate-800">
      <input
        type="checkbox"
        className="size-5 accent-brand-600"
        checked={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <form
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void create.run(classId, weekOf, values);
      }}
    >
      <fieldset className="space-y-1">
        <legend className="sr-only">{t('submit')}</legend>
        {colleagues ? box('colleagues', t('colleagues')) : null}
        {box('faith', t('faith'))}
        {guides ? box('guides', t('guides')) : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!ready || create.pending}>
          {t('submit')}
        </Button>
        <p className="text-sm text-slate-600">{t('note')}</p>
      </div>
    </form>
  );
}
