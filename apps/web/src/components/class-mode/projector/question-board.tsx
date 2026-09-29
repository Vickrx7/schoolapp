'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SLIDE_TYPE } from '../presenter/slide-view';
import { Shape, answerLetter, answerStyle } from '../team-mark';
import { cn } from '../../../lib/utils';
import type { DeviceQuestion, LiveState } from '../../../server/class-portal/schemas';

/**
 * The current question on the projector (DECISIONS D-086, D-090), in large type for a 1080p
 * projector seen from the back of the room (40 px and more at 1920 px wide). Choices carry their
 * letter, shape and colour, as on the devices. From « Afficher la réponse » on it shows how the
 * class answered (bars with the numbers written out) and, only when the teacher shows answers,
 * the right answer and its explanation: `reveal` is null before the reveal, and its `answer`
 * null when answers are hidden, whatever this component does.
 */

type Reveal = NonNullable<LiveState['reveal']>;

export function QuestionBoard({
  question,
  lang,
  reveal,
  answered,
}: {
  question: DeviceQuestion;
  lang: LiveState['lang'];
  reveal: Reveal | null;
  /** Answers to this question so far (the bars' total). */
  answered: number;
}) {
  const t = useTranslations('classMode');
  const answer = reveal?.answer ?? null;
  const count = (key: string) => reveal?.distribution[key] ?? 0;

  return (
    <div className="space-y-[3vh]">
      <div lang={lang} className="space-y-[1.5vh]">
        <p className={cn(SLIDE_TYPE.body, 'font-semibold whitespace-pre-line')}>
          {question.prompt}
        </p>
        {question.hint && !reveal ? (
          <p className={cn(SLIDE_TYPE.small, 'text-slate-700')}>
            {t('question.hint', { text: question.hint })}
          </p>
        ) : null}
      </div>

      {question.kind === 'multiple_choice' ? (
        <>
          {question.multipleAnswers ? (
            <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>{t('question.several')}</p>
          ) : null}
          <ul className="grid grid-cols-2 gap-[1.5vw]">
            {(question.choices ?? []).map((choice, i) => (
              <Choice
                key={choice.id}
                index={i}
                mark={answerLetter(i)}
                lang={lang}
                correct={answer?.choiceIds?.includes(choice.id) ?? false}
                bar={reveal ? { count: count(choice.id), total: answered } : null}
              >
                {choice.text}
              </Choice>
            ))}
          </ul>
        </>
      ) : null}

      {question.kind === 'true_false' ? (
        <ul className="grid grid-cols-2 gap-[1.5vw]">
          {([true, false] as const).map((value, i) => (
            <Choice
              key={String(value)}
              index={i}
              lang="fr-CA"
              correct={answer?.value === value}
              bar={reveal ? { count: count(String(value)), total: answered } : null}
            >
              {value ? t('question.true') : t('question.false')}
            </Choice>
          ))}
        </ul>
      ) : null}

      {question.kind === 'matching' ? (
        <Matching question={question} lang={lang} pairs={answer?.pairs ?? null} />
      ) : null}

      {question.kind === 'ordering' ? (
        <div className="grid grid-cols-2 gap-x-[4vw]">
          <div className="space-y-[1vh]">
            <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>
              {t('question.orderingHelp')}
            </p>
            <ul lang={lang} className={cn(SLIDE_TYPE.doc, 'space-y-[0.3em]')}>
              {(question.items ?? []).map((item, i) => (
                <li key={item.id}>
                  <span className="font-bold">{answerLetter(i)})</span> {item.text}
                </li>
              ))}
            </ul>
          </div>
          {answer?.orderedIds ? (
            <AnswerPanel title={t('reveal.order')}>
              <ol
                lang={lang}
                className={cn(SLIDE_TYPE.doc, 'list-decimal space-y-[0.2em] pl-[1.4em]')}
              >
                {answer.orderedIds.map((id) => (
                  <li key={id}>{question.items?.find((item) => item.id === id)?.text ?? '—'}</li>
                ))}
              </ol>
            </AnswerPanel>
          ) : null}
        </div>
      ) : null}

      {question.kind === 'short_answer' ? (
        <>
          {!reveal ? (
            <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>
              {t('question.shortHelp')}
            </p>
          ) : null}
          {answer?.display?.sampleAnswer ? (
            <AnswerPanel title={t('reveal.sampleAnswer')}>
              <p lang={lang} className={cn(SLIDE_TYPE.doc, 'whitespace-pre-line')}>
                {answer.display.sampleAnswer}
              </p>
            </AnswerPanel>
          ) : null}
          {answer?.display?.acceptable?.length ? (
            <AnswerPanel title={t('reveal.acceptable')}>
              <ul
                lang={lang}
                className={cn(SLIDE_TYPE.doc, 'list-disc space-y-[0.2em] pl-[1.2em]')}
              >
                {answer.display.acceptable.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </AnswerPanel>
          ) : null}
        </>
      ) : null}

      {reveal ? <RevealSummary reveal={reveal} answered={answered} question={question} /> : null}
    </div>
  );
}

function Choice({
  index,
  mark,
  lang,
  correct,
  bar,
  children,
}: {
  index: number;
  /** The letter; true / false show the shape and the word only. */
  mark?: string;
  lang: LiveState['lang'];
  correct: boolean;
  bar: { count: number; total: number } | null;
  children: ReactNode;
}) {
  const t = useTranslations('classMode');
  const style = answerStyle(index);
  const share = bar && bar.total > 0 ? Math.round((100 * bar.count) / bar.total) : 0;
  return (
    <li
      data-correct={correct || undefined}
      className={cn(
        'overflow-hidden rounded-2xl border-[3px] bg-white',
        correct ? 'border-emerald-800 ring-4 ring-emerald-800' : 'border-slate-300',
      )}
    >
      <div className={cn(SLIDE_TYPE.doc, 'flex items-center gap-[0.5em] px-[0.5em] py-[0.35em]')}>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-[0.25em] rounded-xl px-[0.35em] py-[0.1em] font-bold text-white',
            style.bg,
          )}
        >
          <Shape shape={style.shape} className="fill-white" />
          {mark ? <span>{mark}</span> : null}
        </span>
        <span lang={lang} className="min-w-0 flex-1 break-words">
          {children}
        </span>
        {correct ? (
          <span
            className={cn(
              SLIDE_TYPE.small,
              'inline-flex shrink-0 items-center gap-[0.3em] rounded-full bg-emerald-800 px-[0.6em] py-[0.15em] font-semibold text-white',
            )}
          >
            <Check aria-hidden className="size-[1em]" strokeWidth={3} />
            {t('reveal.correct')}
          </span>
        ) : null}
      </div>
      {bar ? (
        <div className="flex items-center gap-[1vw] border-t border-slate-200 px-[0.8vw] py-[0.8vh]">
          <div className="h-[2.2vh] min-h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full', style.bg)} style={{ width: `${share}%` }} />
          </div>
          <span className={cn(SLIDE_TYPE.small, 'shrink-0 font-semibold tabular-nums')}>
            {t('reveal.count', { count: bar.count })}
          </span>
        </div>
      ) : null}
    </li>
  );
}

function Matching({
  question,
  lang,
  pairs,
}: {
  question: DeviceQuestion;
  lang: LiveState['lang'];
  pairs: Record<string, string> | null;
}) {
  const t = useTranslations('classMode');
  const right = question.right ?? [];
  const lettered = (id: string) => {
    const i = right.findIndex((r) => r.id === id);
    return i < 0 ? '—' : `${answerLetter(i)}) ${right[i]!.text}`;
  };
  return (
    <>
      <p
        className={cn(
          SLIDE_TYPE.small,
          pairs ? 'font-semibold text-emerald-900' : 'text-slate-700 italic',
        )}
      >
        {pairs ? t('reveal.pairs') : t('question.matchingHelp')}
      </p>
      <div lang={lang} className={cn(SLIDE_TYPE.doc, 'grid grid-cols-2 gap-x-[4vw] gap-y-[1vh]')}>
        <ol className="space-y-[0.3em]">
          {(question.left ?? []).map((item, i) => (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-[0.3em]">
              <span className="font-bold tabular-nums">{i + 1}.</span>
              <span>{item.text}</span>
              {pairs ? (
                <span className="ml-[0.2em] rounded-lg bg-emerald-800 px-[0.3em] font-bold whitespace-nowrap text-white">
                  {`→ ${pairs[item.id] ? lettered(pairs[item.id]!) : '—'}`}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <ul className="space-y-[0.3em]">
          {right.map((item, i) => (
            <li key={item.id}>
              <span className="font-bold">{answerLetter(i)})</span> {item.text}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function AnswerPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-[0.4em] rounded-2xl border-[3px] border-emerald-800 bg-emerald-50 px-[1.2em] py-[0.8em]">
      <p className={cn(SLIDE_TYPE.small, 'font-semibold text-emerald-900')}>{title}</p>
      {children}
    </div>
  );
}

/** How many got it right, the explanation, or why no answer is shown. */
function RevealSummary({
  reveal,
  answered,
  question,
}: {
  reveal: Reveal;
  answered: number;
  question: DeviceQuestion;
}) {
  const t = useTranslations('classMode');
  const answer = reveal.answer;
  return (
    <div className={cn(SLIDE_TYPE.small, 'space-y-[1vh]')}>
      {reveal.correctCount !== null ? (
        <p className="font-semibold tabular-nums">
          {t('reveal.correctCount', { count: reveal.correctCount, total: answered })}
        </p>
      ) : null}
      {answer === null ? (
        <p className="text-slate-700">{t('reveal.hidden')}</p>
      ) : answer.display?.explanation ? (
        <p className="whitespace-pre-line text-slate-900">
          {t('reveal.explanationText', { text: answer.display.explanation })}
        </p>
      ) : !hasShownAnswer(question, answer) ? (
        <p className="text-slate-700">{t('reveal.noKey')}</p>
      ) : null}
    </div>
  );
}

/** Whether the key entry gave something to mark on screen for this question. */
function hasShownAnswer(question: DeviceQuestion, answer: NonNullable<Reveal['answer']>): boolean {
  switch (question.kind) {
    case 'multiple_choice':
      return Boolean(answer.choiceIds?.length);
    case 'true_false':
      return answer.value !== null;
    case 'matching':
      return answer.pairs !== null;
    case 'ordering':
      return Boolean(answer.orderedIds?.length);
    case 'short_answer':
      return Boolean(answer.display?.sampleAnswer || answer.display?.acceptable?.length);
  }
}
