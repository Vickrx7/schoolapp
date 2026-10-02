import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { formatLocalDate, formatTime } from '@/lib/format';
import { describeAgo } from '@/lib/relative-time';
import { systemLineState } from '@/lib/system-status';
import type { SystemStatus } from '@/server/queries/board';

/**
 * « État du système » (DECISIONS D-112): one sentence, then when the background service, the
 * backup and the data clean-up last ran, in the board's time zone. Never a count: the hosted
 * install serves several boards. A problem asks the admin to tell whoever runs the server: this
 * card notifies nobody, and on a board's own servers that is the board's IT, not IP Lynx (the
 * external monitors of DEPLOYMENT.md page the on-call person). On install day, what has not run
 * yet says « pas encore (… cette nuit) » and « prévu », never « jamais » next to « normal ».
 */
export async function SystemStatusCard({
  status,
  timezone,
  now,
}: {
  status: SystemStatus | null;
  timezone: string;
  now: Date;
}) {
  const t = await getTranslations('board.system');
  const locale = await getLocale();
  const when = (at: string | null) => {
    const ago = describeAgo(at, now, timezone);
    switch (ago.kind) {
      case 'never':
        return t('never');
      case 'justNow':
        return t('justNow');
      case 'minutes':
        return t('minutesAgo', { count: ago.count });
      case 'hours':
        return t('hoursAgo', { count: ago.count });
      case 'yesterday':
        return t('yesterdayAt', { time: formatTime(ago.time, locale) });
      case 'date':
        return t('onDate', {
          date: formatLocalDate(ago.date, locale, { day: 'numeric', month: 'long' }),
          time: formatTime(ago.time, locale),
        });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {status ? (
          <>
            <Notice tone={status.state === 'ok' ? 'success' : 'warning'}>
              {status.state === 'ok' ? t('ok') : t('problem')}
            </Notice>
            <ul className="space-y-1 text-sm text-slate-700">
              {(['worker', 'backup', 'retention'] as const).map((key) => {
                const state = systemLineState(status[key]);
                return (
                  <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      {t('line', {
                        what: t(key),
                        when: state === 'scheduled' ? t(`notYet.${key}`) : when(status[key].at),
                      })}
                    </span>
                    <span
                      className={
                        state === 'problem' ? 'font-medium text-amber-800' : 'text-slate-500'
                      }
                    >
                      {state === 'ok'
                        ? t('lineOk')
                        : state === 'scheduled'
                          ? t('lineScheduled')
                          : t('lineProblem')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-slate-600">{t('unavailable')}</p>
        )}
      </CardBody>
    </Card>
  );
}
