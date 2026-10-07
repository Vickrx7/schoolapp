import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import type { UsageRow } from '@/server/queries/board';

/**
 * « Utilisation de l'IA » for a month (DECISIONS D-104): per school, and the board's bulk
 * generation on its own line. Never per person. Cards on phones, a table from `md:`.
 */
export async function UsageTable({ rows, monthLabel }: { rows: UsageRow[]; monthLabel: string }) {
  const t = await getTranslations('board.usage');
  const locale = await getLocale();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const count = new Intl.NumberFormat(locale);
  const name = (r: UsageRow) => (r.schoolId ? (r.schoolName ?? '—') : t('bulk'));
  const total = rows.reduce(
    (sum, r) => ({
      requests: sum.requests + r.requests,
      failed: sum.failed + r.failed,
      costUsd: sum.costUsd + r.costUsd,
    }),
    { requests: 0, failed: 0, costUsd: 0 },
  );
  const lines = rows.map((r) => ({ key: r.schoolId ?? 'bulk', label: name(r), ...r }));

  return (
    <>
      <ul className="space-y-2 md:hidden">
        {lines.map((r) => (
          <li key={r.key}>
            <Card className="p-4">
              <p className="font-medium text-slate-900">{r.label}</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-slate-600">{t('requests')}</dt>
                  <dd className="tabular-nums">{count.format(r.requests)}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">{t('failed')}</dt>
                  <dd className="tabular-nums">{count.format(r.failed)}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">{t('cost')}</dt>
                  <dd className="tabular-nums">{money.format(r.costUsd)}</dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
        <li>
          <p className="px-1 text-sm font-medium text-slate-900">
            {t('totalLine', { requests: total.requests, cost: money.format(total.costUsd) })}
          </p>
        </li>
      </ul>
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('caption', { month: monthLabel })}</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('school')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('requests')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('failed')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('cost')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="px-4 py-3 font-normal text-slate-900">
                  {r.label}
                </th>
                <td className="px-4 py-3 text-right tabular-nums">{count.format(r.requests)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{count.format(r.failed)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money.format(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 font-medium">
            <tr>
              <th scope="row" className="px-4 py-3 text-slate-900">
                {t('total')}
              </th>
              <td className="px-4 py-3 text-right tabular-nums">{count.format(total.requests)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{count.format(total.failed)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money.format(total.costUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </>
  );
}
