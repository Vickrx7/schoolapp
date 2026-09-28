'use client';

import {
  classifyColumn,
  decodeCsvBytes,
  prepareRosterImport,
  rowsFromPastedText,
  suggestFirstNameColumn,
  type RosterCandidate,
} from '@lynx/domain';
import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import { useMemo, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { cn } from '@/lib/utils';
import { addStudents } from '@/server/actions/students';

type Mode = 'paste' | 'csv';

interface CsvState {
  headers: string[];
  rows: string[][];
  column: number;
}

export function AddStudentsDialog({
  classId,
  existingNames,
}: {
  classId: string;
  existingNames: string[];
}) {
  const t = useTranslations('students');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('paste');
  const draft = useDraft(`students:${classId}`, { text: '' });
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const candidates: RosterCandidate[] = useMemo(() => {
    if (mode === 'paste')
      return prepareRosterImport(rowsFromPastedText(draft.value.text), 0, existingNames);
    if (csv && csv.column >= 0) return prepareRosterImport(csv.rows, csv.column, existingNames);
    return [];
  }, [mode, draft.value.text, csv, existingNames]);
  const importable = candidates.filter((c) => !c.blocked);

  const add = useAction(addStudents, {
    onSuccess: ({ count }) => {
      draft.clear();
      draft.setValue({ text: '' });
      setCsv(null);
      setFileName(null);
      setOpen(false);
      toast.success(t('added', { count }));
    },
  });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    // The file is read here, in the browser. Only the chosen column's values are sent.
    const text = decodeCsvBytes(await file.arrayBuffer());
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    const [headers = [], ...rows] = parsed.data;
    setCsv({ headers, rows, column: suggestFirstNameColumn(headers) });
  };

  const ignored = csv
    ? csv.headers
        .map((h, i) => ({ h, i }))
        .filter(({ i }) => i !== csv.column)
        .map(({ h }) => (classifyColumn(h) === 'sensitive' ? `${h} (${t('sensitiveColumn')})` : h))
    : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('add')} closeLabel={tCommon('close')} className="sm:max-w-2xl">
        <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
          {(['paste', 'csv'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'min-h-10 flex-1 rounded-md text-sm font-medium text-slate-600',
                mode === m && 'bg-white text-slate-900 shadow-sm',
              )}
            >
              {m === 'paste' ? t('pasteLabel') : t('importCsv')}
            </button>
          ))}
        </div>

        {mode === 'paste' ? (
          <div className="space-y-2">
            {draft.restored && draft.value.text ? (
              <Notice tone="info" className="flex items-center justify-between gap-2">
                <span>{tCommon('draftRestored')}</span>
                <Button variant="ghost" size="sm" onClick={draft.discard}>
                  {tCommon('discardDraft')}
                </Button>
              </Notice>
            ) : null}
            <Field label={t('pasteLabel')} htmlFor="paste-names" hint={t('pasteHint')}>
              <Textarea
                id="paste-names"
                value={draft.value.text}
                onChange={(e) => draft.update('text', e.target.value)}
                className="min-h-40"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t('csvHelp')}</p>
            {/* A styled label instead of the browser's own button, whose text follows the
                browser's language rather than the app's. */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-brand-50 px-4 font-medium text-brand-700 focus-within:ring-2 focus-within:ring-brand-500 hover:bg-brand-100">
                {t('chooseFile')}
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={onFile}
                  className="sr-only"
                />
              </label>
              {fileName ? (
                <span className="text-sm break-all text-slate-600">{fileName}</span>
              ) : null}
            </div>
            {csv ? (
              <>
                <Field label={t('chooseColumn')} htmlFor="csv-column">
                  <Select
                    id="csv-column"
                    value={csv.column}
                    onChange={(e) => setCsv({ ...csv, column: Number(e.target.value) })}
                  >
                    <option value={-1}>—</option>
                    {csv.headers.map((h, i) => {
                      const sensitive = classifyColumn(h) === 'sensitive';
                      return (
                        <option key={i} value={i} disabled={sensitive}>
                          {h}
                          {sensitive ? ` (${t('sensitiveColumn')})` : ''}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                {ignored.length ? (
                  <p className="text-sm text-slate-600">
                    {t('ignoredColumns', { columns: ignored.join(', ') })}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        {candidates.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">{t('preview', { count: importable.length })}</h3>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
              {candidates.map((c) => (
                <li
                  key={c.row}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded px-2 py-1',
                    c.blocked && 'bg-red-50 text-red-800',
                  )}
                >
                  <span className="font-medium">{c.value || '—'}</span>
                  {[...c.warnings, ...(c.duplicate ? (['duplicate'] as const) : [])].map((w) => (
                    <span key={w} className="text-xs text-amber-700">
                      {t(`warnings.${w}`)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {candidates.some((c) => c.blocked) ? (
              <p className="mt-1 text-sm text-red-700">{t('blockedRows')}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={add.pending || importable.length === 0}
            onClick={() => void add.run({ classId, firstNames: importable.map((c) => c.value) })}
          >
            {add.pending ? tCommon('saving') : t('importButton', { count: importable.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
