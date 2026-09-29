import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { rankTeams } from '@/components/class-mode/ranking';
import { TeamLabel, answerLetter, answerStyle } from '@/components/class-mode/team-mark';
import { Badge, Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  classPercentCorrect,
  percentCorrect,
  type SessionAggregate,
} from '@/server/class-mode/aggregate';

/**
 * « Résultats gardés » of one session (DECISIONS D-089): class counts only, kept when the teacher
 * ticked « Garder les résultats de la classe (sans noms) ». For each question played, the share
 * of correct answers and, for choices, how many picked each (bars with the numbers written out);
 * the team scores. Never a device, never what a student typed.
 */
export async function SessionResults({ aggregate }: { aggregate: SessionAggregate }) {
  const t = await getTranslations('classMode');
  const overall = classPercentCorrect(aggregate);
  const ranks = aggregate.teams ? rankTeams(aggregate.teams) : [];

  return (
    <div className="space-y-5">
      <p className="text-slate-800">
        {t('results.summary', {
          devices: aggregate.deviceCount,
          played: aggregate.questionsPlayed,
        })}
      </p>
      {overall !== null ? (
        <p className="text-2xl font-bold text-slate-900">
          {t('results.overall', { percent: overall })}
        </p>
      ) : null}
      {!aggregate.revealAnswers ? <Notice>{t('results.hiddenAnswers')}</Notice> : null}

      {aggregate.teams?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('results.teams')}</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-2">
              {aggregate.teams.map((row, i) => (
                <li key={row.team} className="flex min-h-11 items-center gap-3">
                  <span className="w-10 shrink-0 font-semibold text-slate-700 tabular-nums">
                    {ranks[i] == null ? '' : t('leaderboard.rank', { rank: ranks[i]! })}
                  </span>
                  <TeamLabel team={row.team} name={t(`teams.${row.team}`)} className="flex-1" />
                  <span className="font-semibold tabular-nums">
                    {row.score === null
                      ? t('leaderboard.noDevice')
                      : t('leaderboard.points', { points: row.score })}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <section aria-labelledby="results-questions" className="space-y-3">
        <h2 id="results-questions" className="text-lg font-semibold text-slate-900">
          {t('results.perQuestion')}
        </h2>
        <ol className="space-y-3">
          {aggregate.questions.map((q) => {
            const percent = percentCorrect(q);
            return (
              <li key={`${q.index}-${q.id}`}>
                <Card>
                  <CardBody className="space-y-3 pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 font-medium whitespace-pre-line text-slate-900">
                        <span className="mr-2 text-slate-600 tabular-nums">{q.index + 1}.</span>
                        {q.prompt}
                      </p>
                      {percent !== null ? (
                        <Badge tone="brand" className="text-sm">
                          {t('results.percentCorrect', { percent })}
                        </Badge>
                      ) : (
                        <Badge className="text-sm">
                          {q.scorable ? t('results.noAnswer') : t('results.notScored')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600">
                      {t('results.answered', { count: q.answered })}
                    </p>
                    {q.choices?.length ? (
                      <ul className="space-y-2">
                        {q.choices.map((choice, i) => {
                          const share = q.answered
                            ? Math.round((100 * choice.count) / q.answered)
                            : 0;
                          const style = answerStyle(i);
                          return (
                            <li key={choice.id} className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span
                                  className={cn(
                                    'inline-flex min-w-7 justify-center rounded px-1.5 font-bold text-white',
                                    style.bg,
                                  )}
                                >
                                  {answerLetter(i)}
                                </span>
                                <span className="min-w-0 flex-1 text-slate-900">{choice.text}</span>
                                {choice.correct ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                                    <Check aria-hidden className="size-4" strokeWidth={3} />
                                    {t('results.correct')}
                                  </span>
                                ) : null}
                                <span className="font-semibold tabular-nums">
                                  {t('results.choiceCount', { count: choice.count })}
                                </span>
                              </div>
                              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={cn('h-full rounded-full', style.bg)}
                                  style={{ width: `${share}%` }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {q.trueFalse ? (
                      <p className="text-sm text-slate-800 tabular-nums">
                        {t('results.trueFalse', {
                          trueCount: q.trueFalse.trueCount,
                          falseCount: q.trueFalse.falseCount,
                        })}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
