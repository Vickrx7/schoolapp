import type {
  ChoiceOption,
  DocBlock,
  LeafBlock,
  QuestionBlock,
  Slide,
  SlideQuestion,
} from '@lynx/content';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type messages from '../../../../messages/fr-CA.json';
// Relative, so the unit test can render it without the app's path alias.
import { cn } from '../../../lib/utils';
import type { PresenterAnswer } from '../../../server/class-mode/presenter';
import { CHOICE_LETTERS, ChoiceMark, ChoiceShape } from './choice-mark';

/**
 * One projected slide of « Présenter à la classe » (DECISIONS D-082, D-090), in large type for a
 * 1080p projector seen from the back of the room: at least 40 px at 1920 px wide, 56 px for a
 * step, scaling with the width down to the 768 px minimum. Labels on the slide (« Étape 2 sur
 * 6 », « Sécurité », « Vrai »…) are in the content's language, like the content itself (`lang` on
 * the slide): `t` translates `classPresenter.slide` in that language. The player's controls
 * stay in the interface language.
 *
 * No hooks, so it renders on the server in unit tests. It draws only what a slide holds, which
 * `presentSlides` builds from the student content: an answer appears only in `answer`, fetched
 * for this question when the teacher presses « Afficher la réponse ».
 */

export type SlideMessages = (typeof messages)['classPresenter']['slide'];
export type SlideText = (
  key: keyof SlideMessages,
  values?: Record<string, string | number>,
) => string;

/** Type sizes (CSS clamp: minimum, preferred with the width, maximum at 1080p and more). */
export const SLIDE_TYPE = {
  /** The title slide's title: 80 px at 1920 px wide. */
  hero: 'text-[length:clamp(2.25rem,1rem_+_4vw,5rem)] leading-tight',
  /** A slide's heading (« Étape 2 sur 6 », « Sécurité »): 48 px. */
  heading: 'text-[length:clamp(1.5rem,0.75rem_+_2vw,3rem)] leading-tight',
  /** One step (D-082): 56 px. */
  step: 'text-[length:clamp(2rem,1rem_+_2.8vw,3.5rem)] leading-snug',
  /** Prompts, reminders, the objective: 56 px. */
  body: 'text-[length:clamp(1.75rem,1rem_+_2.4vw,3.5rem)] leading-snug',
  /** Documents, rules and choices: 48 px. */
  doc: 'text-[length:clamp(1.5rem,0.75rem_+_2.2vw,3rem)] leading-snug',
  /** Hints, explanations, notes: 40 px, never less at 1080p (D-090). */
  small: 'text-[length:clamp(1.25rem,0.75rem_+_1.6vw,2.5rem)] leading-snug',
} as const;

const LABEL = 'font-semibold text-slate-700';

function Heading({ children }: { children: ReactNode }) {
  return <h2 className={cn(SLIDE_TYPE.heading, LABEL)}>{children}</h2>;
}

function Paragraphs({ items, className }: { items: readonly string[]; className: string }) {
  return (
    <>
      {items.map((text, i) => (
        <p key={i} className={cn('whitespace-pre-line', className)}>
          {text}
        </p>
      ))}
    </>
  );
}

function BulletList({ items, className }: { items: readonly string[]; className: string }) {
  return (
    <ul className={cn('list-disc space-y-[0.4em] pl-[1.2em] marker:text-slate-500', className)}>
      {items.map((item, i) => (
        <li key={i} className="whitespace-pre-line">
          {item}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------------------

function CorrectBadge({ t }: { t: SlideText }) {
  return (
    <span
      className={cn(
        SLIDE_TYPE.small,
        'ml-auto inline-flex shrink-0 items-center gap-[0.3em] rounded-full bg-emerald-800 px-[0.6em] py-[0.15em] font-semibold text-white',
      )}
    >
      <Check aria-hidden className="size-[1em]" strokeWidth={3} />
      {t('correct')}
    </span>
  );
}

function ChoiceCard({
  index,
  children,
  correct,
  t,
  mark = 'letter',
}: {
  index: number;
  children: ReactNode;
  /** After « Afficher la réponse »: this is a right answer. */
  correct: boolean;
  t: SlideText;
  mark?: 'letter' | 'shape';
}) {
  return (
    <li
      className={cn(
        SLIDE_TYPE.doc,
        'flex items-center gap-[0.5em] rounded-2xl border-[3px] px-[0.6em] py-[0.4em]',
        correct ? 'border-emerald-800 bg-emerald-50 ring-4 ring-emerald-800' : 'border-slate-300',
      )}
      data-correct={correct || undefined}
    >
      {mark === 'letter' ? <ChoiceMark index={index} /> : <ChoiceShape index={index} />}
      <span className="min-w-0 break-words">{children}</span>
      {correct ? <CorrectBadge t={t} /> : null}
    </li>
  );
}

const textOf = (options: readonly ChoiceOption[], id: string) =>
  options.find((o) => o.id === id)?.text ?? '';

/** « A) 345 » for an option of a list shown with letters. */
const lettered = (options: readonly ChoiceOption[], id: string) => {
  const index = options.findIndex((o) => o.id === id);
  return index < 0 ? '—' : `${CHOICE_LETTERS[index] ?? index + 1}) ${options[index]!.text}`;
};

function AnswerPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-[0.4em] rounded-2xl border-[3px] border-emerald-800 bg-emerald-50 px-[1.2em] py-[0.8em]">
      <p className={cn(SLIDE_TYPE.small, 'font-semibold text-emerald-900')}>{title}</p>
      {children}
    </div>
  );
}

/**
 * What « Afficher la réponse » adds, in the question's answer region (announced to screen
 * readers). Choices and pairs are also marked where they are on the slide; the order and a
 * short answer's sample take the place of the items, so nothing falls below the fold.
 */
function Revealed({
  question,
  answer,
  t,
}: {
  question: SlideQuestion;
  answer: PresenterAnswer | null;
  t: SlideText;
}) {
  if (answer === null) {
    return <p className={cn(SLIDE_TYPE.small, 'text-slate-700')}>{t('noAnswer')}</p>;
  }
  let detail: ReactNode = null;
  switch (answer.kind) {
    case 'multiple_choice': {
      const right = question.choices.flatMap((c, i) =>
        answer.correctChoiceIds.includes(c.id) ? [`${CHOICE_LETTERS[i] ?? i + 1}) ${c.text}`] : [],
      );
      detail = <p className="sr-only">{t('correctIs', { answer: right.join(' ; ') })}</p>;
      break;
    }
    case 'true_false':
      detail = (
        <p className="sr-only">
          {t('correctIs', { answer: answer.correct ? t('trueLabel') : t('falseLabel') })}
        </p>
      );
      break;
    case 'matching': {
      const pairs = question.left.map((left, i) => {
        const pair = answer.pairs.find((p) => p.leftId === left.id);
        return `${i + 1}. ${left.text} → ${pair ? lettered(question.right, pair.rightId) : '—'}`;
      });
      detail = <p className="sr-only">{t('pairsAre', { pairs: pairs.join(' ; ') })}</p>;
      break;
    }
    case 'ordering':
      detail = (
        <AnswerPanel title={t('expectedOrder')}>
          <ol className={cn(SLIDE_TYPE.doc, 'list-decimal space-y-[0.2em] pl-[1.4em]')}>
            {answer.orderedIds.map((id) => (
              <li key={id}>{textOf(question.items, id)}</li>
            ))}
          </ol>
        </AnswerPanel>
      );
      break;
    case 'short_answer':
      detail =
        answer.sampleAnswer || answer.acceptableAnswers.length ? (
          <>
            {answer.sampleAnswer ? (
              <AnswerPanel title={t('sampleAnswer')}>
                <p className={cn(SLIDE_TYPE.doc, 'whitespace-pre-line')}>{answer.sampleAnswer}</p>
              </AnswerPanel>
            ) : null}
            {answer.acceptableAnswers.length ? (
              <AnswerPanel title={t('acceptedAnswers')}>
                <BulletList items={answer.acceptableAnswers} className={SLIDE_TYPE.doc} />
              </AnswerPanel>
            ) : null}
          </>
        ) : (
          <p className={cn(SLIDE_TYPE.small, 'text-slate-700')}>{t('noAnswer')}</p>
        );
      break;
  }
  return (
    <>
      {detail}
      {answer.explanation ? (
        <p className={cn(SLIDE_TYPE.small, 'whitespace-pre-line text-slate-900')}>
          {t('explanation', { text: answer.explanation })}
        </p>
      ) : null}
    </>
  );
}

function QuestionSlide({
  slide,
  answer,
  answerId,
  t,
}: {
  slide: Extract<Slide, { kind: 'question' }>;
  answer: PresenterAnswer | null | undefined;
  answerId: string;
  t: SlideText;
}) {
  const { question } = slide;
  const correctChoices = new Set(answer?.kind === 'multiple_choice' ? answer.correctChoiceIds : []);
  const pairs = answer?.kind === 'matching' ? answer.pairs : null;
  const ordered = answer?.kind === 'ordering';
  return (
    <div className="space-y-[3vh]">
      <Heading>{t('question', { n: slide.number, total: slide.total })}</Heading>
      <p className={cn(SLIDE_TYPE.body, 'font-semibold whitespace-pre-line')}>{question.prompt}</p>
      {question.hint ? (
        <p className={cn(SLIDE_TYPE.small, 'text-slate-700')}>
          {t('hint', { text: question.hint })}
        </p>
      ) : null}

      {question.kind === 'multiple_choice' ? (
        <>
          {question.multipleAnswers ? (
            <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>{t('severalAnswers')}</p>
          ) : null}
          <ul className="grid grid-cols-2 gap-[1.5vw]">
            {question.choices.map((choice, i) => (
              <ChoiceCard key={choice.id} index={i} correct={correctChoices.has(choice.id)} t={t}>
                {choice.text}
              </ChoiceCard>
            ))}
          </ul>
        </>
      ) : null}

      {question.kind === 'true_false' ? (
        <ul className="grid grid-cols-2 gap-[1.5vw]">
          {([true, false] as const).map((value, i) => (
            <ChoiceCard
              key={String(value)}
              index={i}
              mark="shape"
              correct={answer?.kind === 'true_false' && answer.correct === value}
              t={t}
            >
              {value ? t('trueLabel') : t('falseLabel')}
            </ChoiceCard>
          ))}
        </ul>
      ) : null}

      {question.kind === 'matching' ? (
        <>
          <p
            className={cn(
              SLIDE_TYPE.small,
              pairs ? 'font-semibold text-emerald-900' : 'text-slate-700 italic',
            )}
          >
            {pairs ? t('pairs') : t('matchingHelp')}
          </p>
          <div className={cn(SLIDE_TYPE.doc, 'grid grid-cols-2 gap-x-[4vw] gap-y-[1vh]')}>
            <ol className="space-y-[0.3em]">
              {question.left.map((item, i) => {
                const pair = pairs?.find((p) => p.leftId === item.id);
                return (
                  <li key={item.id} className="flex flex-wrap items-baseline gap-x-[0.3em]">
                    <span className="font-bold tabular-nums">{i + 1}.</span>
                    <span>{item.text}</span>
                    {pairs ? (
                      <span
                        aria-hidden
                        className="ml-[0.2em] rounded-lg bg-emerald-800 px-[0.3em] font-bold whitespace-nowrap text-white"
                      >
                        {`→ ${pair ? lettered(question.right, pair.rightId) : '—'}`}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <ul className="space-y-[0.3em]">
              {question.right.map((item, i) => (
                <li key={item.id}>
                  <span className="font-bold">{CHOICE_LETTERS[i] ?? i + 1})</span> {item.text}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {question.kind === 'ordering' && !ordered ? (
        <>
          <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>{t('orderingHelp')}</p>
          <ul className="grid grid-cols-2 gap-[1.5vw]">
            {question.items.map((item, i) => (
              <ChoiceCard key={item.id} index={i} correct={false} t={t}>
                {item.text}
              </ChoiceCard>
            ))}
          </ul>
        </>
      ) : null}

      {/* Always in the page, so « Afficher la réponse » can point at it (aria-controls). */}
      <div id={answerId} aria-live="polite" className="space-y-[2vh]">
        {answer === undefined ? null : <Revealed question={question} answer={answer} t={t} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Documents (any other projectable type): one section per slide
// ---------------------------------------------------------------------------------------

function DocQuestion({ block, t }: { block: QuestionBlock; t: SlideText }) {
  return (
    <div className="space-y-[0.5em]">
      <p className="font-semibold whitespace-pre-line">
        <span className="tabular-nums">{block.number}.</span> {block.prompt}
      </p>
      {block.hint ? (
        <p className={cn(SLIDE_TYPE.small, 'text-slate-700')}>{t('hint', { text: block.hint })}</p>
      ) : null}
      {block.kind === 'multiple_choice' && block.multipleAnswers ? (
        <p className={cn(SLIDE_TYPE.small, 'text-slate-700 italic')}>{t('severalAnswers')}</p>
      ) : null}
      {block.kind === 'multiple_choice' ||
      block.kind === 'ordering' ||
      block.kind === 'true_false' ? (
        <ul className="space-y-[0.3em] pl-[1em]">
          {block.choices.map((c, i) => (
            <li key={i}>{c.label ? `${c.label}) ${c.text}` : c.text}</li>
          ))}
        </ul>
      ) : null}
      {block.kind === 'matching' ? (
        <div className="grid grid-cols-2 gap-x-[4vw] gap-y-[0.3em] pl-[1em]">
          <ul className="space-y-[0.3em]">
            {block.left.map((o, i) => (
              <li key={i}>{`${o.label}. ${o.text}`}</li>
            ))}
          </ul>
          <ul className="space-y-[0.3em]">
            {block.right.map((o, i) => (
              <li key={i}>{`${o.label}) ${o.text}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role={label ? 'region' : undefined}
      aria-label={label || undefined}
    >
      {children}
    </div>
  );
}

function DocLeaf({ block, t }: { block: LeafBlock; t: SlideText }) {
  switch (block.type) {
    case 'heading': {
      // Sections of the document are the slide's heading (h2, under the page's title); their
      // subsections are h3.
      const Tag = block.level <= 2 ? 'h2' : 'h3';
      return (
        <Tag className={cn(block.level <= 2 ? SLIDE_TYPE.heading : SLIDE_TYPE.doc, 'font-bold')}>
          {block.text}
        </Tag>
      );
    }
    case 'paragraph':
      return <p className="whitespace-pre-line">{block.text}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={cn('space-y-[0.3em] pl-[1.3em]', block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((item, i) => (
            <li key={i} className="whitespace-pre-line">
              {item}
            </li>
          ))}
        </Tag>
      );
    }
    case 'steps':
      return (
        <ol className="list-decimal space-y-[0.4em] pl-[1.3em]">
          {block.items.map((step, i) => (
            <li key={i} className="whitespace-pre-line">
              {step.text}
              {step.detail ? (
                <span className={cn(SLIDE_TYPE.small, 'block text-slate-700')}>{step.detail}</span>
              ) : null}
            </li>
          ))}
        </ol>
      );
    case 'glossary':
      return (
        <dl className="space-y-[0.3em]">
          {block.entries.map((e, i) => (
            <div key={i}>
              <dt className="inline font-semibold">{e.term}</dt>
              {e.definition ? <dd className="inline"> : {e.definition}</dd> : null}
            </div>
          ))}
        </dl>
      );
    case 'question':
      return <DocQuestion block={block} t={t} />;
    case 'table':
      return (
        <ScrollTable label={block.caption}>
          <table className="w-full border-collapse text-left">
            {block.caption ? (
              <caption className="mb-[0.3em] text-left font-semibold">{block.caption}</caption>
            ) : null}
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-2 border-slate-400 bg-slate-100 px-[0.4em]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {block.columns.map((_, j) => (
                    <td key={j} className="border-2 border-slate-400 px-[0.4em] align-top">
                      {row[j] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      );
    case 'callout':
      return (
        <div className="space-y-[0.3em] rounded-2xl border-[3px] border-slate-300 bg-slate-50 px-[0.8em] py-[0.5em]">
          <p className="font-semibold">{block.title}</p>
          {block.text ? <p className="whitespace-pre-line">{block.text}</p> : null}
          {block.items.length ? <BulletList items={block.items} className="" /> : null}
        </div>
      );
    case 'rubric':
      return (
        <ScrollTable label={block.caption}>
          <table className={cn(SLIDE_TYPE.small, 'w-full border-collapse text-left')}>
            <caption className="mb-[0.3em] text-left font-semibold">{block.caption}</caption>
            <thead>
              <tr>
                <td className="border-2 border-slate-400" />
                {block.levels.map((level, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-2 border-slate-400 bg-slate-100 px-[0.4em]"
                  >
                    {level}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    className="border-2 border-slate-400 px-[0.4em] text-left align-top"
                  >
                    {row.category ? (
                      <span className="block font-normal text-slate-700">{row.category}</span>
                    ) : null}
                    {row.criterion}
                  </th>
                  {row.cells.map((cell, j) => (
                    <td key={j} className="border-2 border-slate-400 px-[0.4em] align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      );
    case 'poem':
      return (
        <div>
          {block.title ? <p className="font-semibold">{block.title}</p> : null}
          <p className="whitespace-pre-line">{block.lines.join('\n')}</p>
        </div>
      );
    // Paper only (writing lines, « Nom : ____ »), and answers, which a student document never
    // holds: never projected.
    case 'lines':
    case 'nameLine':
    case 'answer':
      return null;
  }
}

function DocBlocks({ blocks, t }: { blocks: readonly DocBlock[]; t: SlideText }) {
  return (
    <div className={cn(SLIDE_TYPE.doc, 'space-y-[2.5vh]')}>
      {blocks.map((block, i) =>
        block.type === 'section' ? (
          <section key={i} lang={block.lang} className="space-y-[2vh]">
            <h2 className={cn(SLIDE_TYPE.heading, 'font-bold')}>{block.title}</h2>
            {block.blocks.map((b, j) => (
              <DocLeaf key={j} block={b} t={t} />
            ))}
          </section>
        ) : (
          <DocLeaf key={i} block={block} t={t} />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The slide
// ---------------------------------------------------------------------------------------

export function SlideView({
  slide,
  t,
  answer,
  answerId,
}: {
  slide: Slide;
  /** `classPresenter.slide` in the content's language. */
  t: SlideText;
  /**
   * Question slides: undefined until « Afficher la réponse »; then the answer, or null when the
   * key has none for this question.
   */
  answer?: PresenterAnswer | null;
  /** The id of the question's answer region (`aria-controls` of « Afficher la réponse »). */
  answerId: string;
}) {
  switch (slide.kind) {
    case 'title':
      return (
        <div className="flex min-h-full flex-col justify-center space-y-[4vh]">
          <h2 className={cn(SLIDE_TYPE.hero, 'font-bold text-balance')}>{slide.title}</h2>
          {slide.objective ? (
            <div className="space-y-[1vh]">
              <p className={cn(SLIDE_TYPE.small, LABEL)}>{t('objective')}</p>
              <p className={cn(SLIDE_TYPE.body, 'whitespace-pre-line')}>{slide.objective}</p>
            </div>
          ) : null}
          <Paragraphs items={slide.intro} className={SLIDE_TYPE.doc} />
          {slide.durationMinutes ? (
            <p className={cn(SLIDE_TYPE.small, LABEL)}>
              {t('duration', { minutes: slide.durationMinutes })}
            </p>
          ) : null}
        </div>
      );
    case 'safety':
      return (
        <div className="space-y-[4vh]">
          <Heading>{t('safety')}</Heading>
          {slide.reminders.length ? (
            <BulletList items={slide.reminders} className={SLIDE_TYPE.body} />
          ) : (
            <p className={SLIDE_TYPE.body}>{t('safetyGeneric')}</p>
          )}
        </div>
      );
    case 'materials':
      return (
        <div className="space-y-[4vh]">
          <Heading>{t('materials')}</Heading>
          <Paragraphs items={slide.paragraphs} className={SLIDE_TYPE.doc} />
        </div>
      );
    case 'step':
      return (
        <div className="flex min-h-full flex-col justify-center space-y-[4vh]">
          <Heading>{t('step', { n: slide.number, total: slide.total })}</Heading>
          <p className={cn(SLIDE_TYPE.step, 'font-medium whitespace-pre-line')}>{slide.text}</p>
        </div>
      );
    case 'rules':
      return (
        <div className="space-y-[3vh]">
          <Heading>{t('rules')}</Heading>
          {slide.grouping ? (
            <p className={cn(SLIDE_TYPE.small, LABEL)}>{t('grouping', { text: slide.grouping })}</p>
          ) : null}
          <div className="grid grid-cols-1 gap-x-[4vw] gap-y-[3vh] xl:grid-cols-[3fr_2fr]">
            {slide.rules.length ? (
              <ol className={cn(SLIDE_TYPE.doc, 'list-decimal space-y-[0.4em] pl-[1.4em]')}>
                {slide.rules.map((rule, i) => (
                  <li key={i} className="whitespace-pre-line">
                    {rule}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="space-y-[3vh]">
              {slide.howToWin ? (
                <div className="space-y-[1vh]">
                  <h3 className={cn(SLIDE_TYPE.small, LABEL)}>{t('howToWin')}</h3>
                  <p className={cn(SLIDE_TYPE.doc, 'whitespace-pre-line')}>{slide.howToWin}</p>
                </div>
              ) : null}
              {slide.variations.length ? (
                <div className="space-y-[1vh]">
                  <h3 className={cn(SLIDE_TYPE.small, LABEL)}>{t('variations')}</h3>
                  <BulletList items={slide.variations} className={SLIDE_TYPE.small} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    case 'question':
      return <QuestionSlide slide={slide} answer={answer} answerId={answerId} t={t} />;
    case 'document':
      return <DocBlocks blocks={slide.blocks} t={t} />;
    case 'end':
      return (
        <div className="flex min-h-full items-center justify-center">
          <h2 className={cn(SLIDE_TYPE.hero, 'font-bold')}>{t('end')}</h2>
        </div>
      );
  }
}
