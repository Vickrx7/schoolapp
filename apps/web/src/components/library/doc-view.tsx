import {
  DOC_LABELS_FR,
  labelled,
  type DocBlock,
  type LeafBlock,
  type QuestionBlock,
  type RenderedDoc,
} from '@lynx/content';
import type { ReactNode } from 'react';
// Relative, so the unit test can render it without the app's path alias.
import { cn } from '../../lib/utils';

/**
 * A library document (`RenderedDoc`, DECISIONS D-075) as HTML: the item page's tabs, the print
 * page and substitute plans draw documents with it. Documents are in their content's language
 * whatever the interface language (D-033): the container carries `lang="fr-CA"`, the English half
 * of a family guide `lang="en-CA"`, and the few words DocView adds (« Indice », « Vrai »…) come
 * from the document labels, in French. No hooks: usable in server and client components.
 *
 * Choice boxes and writing lines are drawn with borders, never glyphs, so they print the same
 * everywhere.
 */

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function Heading({
  level,
  className,
  children,
}: {
  level: number;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${Math.min(6, Math.max(1, level)) as HeadingLevel}` as const;
  return <Tag className={className}>{children}</Tag>;
}

/** An empty box to tick or to write a number or a letter in. */
function Box({ wide = false }: { wide?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-sm border border-slate-500',
        wide ? 'h-6 w-8' : 'size-4',
      )}
    />
  );
}

function WritingLines({ count }: { count: number }) {
  return (
    <div aria-hidden className="space-y-0">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-8 border-b border-slate-400" />
      ))}
    </div>
  );
}

/**
 * A box that scrolls sideways on its own (wide tables on a phone). It can take the keyboard
 * focus, so the part out of view can be reached without a mouse (WCAG 2.1.1).
 */
function ScrollBox({ label, children }: { label: string; children: ReactNode }) {
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

const CALLOUT_TONES: Record<string, string> = {
  info: 'border-brand-200 bg-brand-50',
  teacher: 'border-slate-300 bg-slate-50',
  safety: 'border-amber-300 bg-amber-50',
  faith: 'border-violet-200 bg-violet-50',
  warning: 'border-red-200 bg-red-50',
};

function Question({ block }: { block: QuestionBlock }) {
  const L = DOC_LABELS_FR;
  return (
    <div className="space-y-2 break-inside-avoid">
      <p>
        <span className="font-semibold tabular-nums">{block.number}.</span> {block.prompt}
        {block.points ? (
          <span className="text-sm whitespace-nowrap text-slate-600">
            {' '}
            ({L.points(block.points)})
          </span>
        ) : null}
      </p>
      {block.category ? <p className="text-xs text-slate-600 italic">{block.category}</p> : null}
      {block.hint ? <p className="text-sm text-slate-700">{labelled(L.hint, block.hint)}</p> : null}
      {block.kind === 'multiple_choice' ? (
        <>
          {block.multipleAnswers ? <p className="text-sm italic">{L.severalAnswers}</p> : null}
          <ul className="space-y-1.5 pl-4">
            {block.choices.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1">
                  <Box />
                </span>
                <span>
                  {c.label}) {c.text}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {block.kind === 'true_false' ? (
        <ul className="flex flex-wrap gap-x-8 gap-y-1.5 pl-4">
          {block.choices.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <Box />
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {block.kind === 'ordering' ? (
        <>
          <p className="text-sm italic">{L.orderingHelp}</p>
          <ul className="space-y-1.5 pl-4">
            {block.choices.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <Box wide />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {block.kind === 'matching' ? (
        <>
          <p className="text-sm italic">{L.matchingHelp}</p>
          <div className="grid gap-x-8 gap-y-2 pl-4 sm:grid-cols-2 print:grid-cols-2">
            <ul className="space-y-1.5">
              {block.left.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>
                    {o.label}. {o.text}
                  </span>
                  <Box wide />
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5">
              {block.right.map((o, i) => (
                <li key={i}>
                  {o.label}) {o.text}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      {block.kind === 'short_answer' && block.lines > 0 ? (
        <WritingLines count={block.lines} />
      ) : null}
    </div>
  );
}

function Leaf({ block, level }: { block: LeafBlock; level: number }) {
  const L = DOC_LABELS_FR;
  switch (block.type) {
    case 'heading':
      // Documents use level 2 for their sections and 3 below: level 2 sits right under the title.
      return (
        <Heading
          level={Math.max(level, level + block.level - 2)}
          className={cn('font-semibold', block.level <= 2 ? 'text-lg' : 'text-base')}
        >
          {block.text}
        </Heading>
      );
    case 'paragraph':
      return <p className="whitespace-pre-line">{block.text}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('space-y-1 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}>
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
        <ol className="list-decimal space-y-2 pl-6">
          {block.items.map((step, i) => (
            <li key={i}>
              <p className="whitespace-pre-line">
                {step.minutes ? (
                  <span className="mr-1 text-sm whitespace-nowrap text-slate-600 tabular-nums">
                    ({L.minutes(step.minutes)})
                  </span>
                ) : null}
                {step.text}
              </p>
              {step.detail ? (
                <p className="mt-0.5 text-sm whitespace-pre-line text-slate-700 italic">
                  {step.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      );
    case 'glossary':
      return (
        <dl className="space-y-1">
          {block.entries.map((e, i) => (
            <div key={i}>
              <dt className="inline font-semibold">{e.term}</dt>
              {e.definition ? <dd className="inline"> : {e.definition}</dd> : null}
            </div>
          ))}
        </dl>
      );
    case 'question':
      return <Question block={block} />;
    case 'table':
      return (
        <ScrollBox label={block.caption}>
          <table className="w-full border-collapse text-left text-sm">
            {block.caption ? (
              <caption className="mb-1 text-left font-semibold">{block.caption}</caption>
            ) : null}
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i} scope="col" className="border border-slate-300 bg-slate-50 px-2 py-1">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {block.columns.map((_, j) => (
                    <td key={j} className="h-9 border border-slate-300 px-2 py-1 align-top">
                      {row[j] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      );
    case 'lines':
      return <WritingLines count={block.count} />;
    case 'callout':
      return (
        <div
          className={cn(
            'rounded-lg border p-3 break-inside-avoid',
            CALLOUT_TONES[block.tone] ?? CALLOUT_TONES.info,
          )}
        >
          <p className="font-semibold">{block.title}</p>
          {block.text ? <p className="mt-1 whitespace-pre-line">{block.text}</p> : null}
          {block.items.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case 'rubric':
      // A wide table scrolls in its own box on phones; the page never scrolls sideways (G6).
      return (
        <ScrollBox label={block.caption}>
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm print:min-w-0">
            <caption className="mb-1 text-left font-semibold">{block.caption}</caption>
            <thead>
              <tr>
                <th scope="col" className="border border-slate-300 bg-slate-50 px-2 py-1">
                  {L.criterion}
                </th>
                {block.levels.map((level, i) => (
                  <th key={i} scope="col" className="border border-slate-300 bg-slate-50 px-2 py-1">
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
                    className="border border-slate-300 px-2 py-1 align-top font-normal"
                  >
                    <span className="block text-xs text-slate-600">{row.category}</span>
                    <span className="font-semibold">{row.criterion}</span>
                  </th>
                  {row.cells.map((cell, j) => (
                    <td key={j} className="border border-slate-300 px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      );
    case 'answer':
      return (
        <div className="break-inside-avoid">
          <p>
            <span className="font-semibold tabular-nums">{block.number}.</span> {block.text}
          </p>
          {block.details.length ? (
            <ul className="mt-0.5 space-y-0.5 pl-6 text-sm">
              {block.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
          {block.explanation ? (
            <p className="mt-0.5 pl-6 text-sm text-slate-700">
              {labelled(L.explanation, block.explanation)}
            </p>
          ) : null}
        </div>
      );
    case 'poem':
      return (
        <div className="break-inside-avoid">
          {block.title ? <p className="font-semibold">{block.title}</p> : null}
          <p className="whitespace-pre-line">{block.lines.join('\n')}</p>
        </div>
      );
  }
}

function Block({ block, level }: { block: DocBlock; level: number }) {
  if (block.type !== 'section') return <Leaf block={block} level={level} />;
  return (
    <section lang={block.lang} className="space-y-3">
      <Heading level={level} className="text-lg font-semibold">
        {block.title}
      </Heading>
      {block.blocks.map((b, i) => (
        <Leaf key={i} block={b} level={level + 1} />
      ))}
    </section>
  );
}

export function DocView({
  doc,
  titleLevel = 2,
  variant = 'screen',
  showNumber = false,
  className,
}: {
  doc: RenderedDoc;
  /**
   * The heading level of the document's title; its sections go one level down (4 inside a
   * substitute plan's period, whose title is a level 3 heading).
   */
  titleLevel?: 1 | 2 | 3 | 4;
  /** `sheet`: a printed page (larger serif text, like the Phase 2 student copies). */
  variant?: 'screen' | 'sheet';
  /** The small version number (never a level name, D-042). */
  showNumber?: boolean;
  className?: string;
}) {
  return (
    <article
      lang={doc.lang}
      className={cn(
        'space-y-3 break-words text-slate-900',
        variant === 'sheet' ? 'font-serif text-lg leading-relaxed print:text-black' : 'text-base',
        className,
      )}
    >
      {showNumber && doc.number !== null ? (
        <p className="text-right font-sans text-xs text-slate-500" data-testid="sheet-number">
          {doc.number}
        </p>
      ) : null}
      <header>
        <Heading
          level={titleLevel}
          className={cn('font-bold', variant === 'sheet' ? 'text-2xl' : 'text-xl')}
        >
          {doc.title}
        </Heading>
        {doc.subtitle ? <p className="text-sm text-slate-600">{doc.subtitle}</p> : null}
      </header>
      {doc.blocks.map((block, i) => (
        <Block key={i} block={block} level={titleLevel + 1} />
      ))}
    </article>
  );
}
