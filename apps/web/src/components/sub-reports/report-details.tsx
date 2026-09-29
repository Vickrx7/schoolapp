import { useTranslations } from 'next-intl';
import { TypedText } from '@/components/sub-plans/block-card';
import { Badge, Notice } from '@/components/ui/card';
import { formatTimeRange } from '@/lib/format';
import type { ReportLessonView, ReportView } from '@/server/queries/sub-reports';

/**
 * How the substitute's report reads for the teacher and the direction (DECISIONS D-054): the
 * substitute's words are shown as written (never translated), labels follow the interface.
 */

/** A reported lesson: when, which lesson, what the substitute said and her note. */
export function ReportLessonHeader({
  lesson,
  headingId,
  locale,
  showProgress = false,
}: {
  lesson: ReportLessonView;
  headingId?: string;
  locale: string;
  /** The lesson's progress now (after confirmation). */
  showProgress?: boolean;
}) {
  const t = useTranslations('subReport');
  return (
    <div className="space-y-1">
      <div id={headingId}>
        <p className="text-sm text-slate-600 tabular-nums">
          {[
            lesson.start && lesson.end ? formatTimeRange(lesson.start, lesson.end, locale) : null,
            lesson.className,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <h3 className="font-semibold text-slate-900">
          {t('lessonLine', { n: lesson.sequenceNumber, title: lesson.title })}
        </h3>
        <p className="text-sm text-slate-600">{lesson.unitTitle}</p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
        <span>
          {t('said', {
            outcome: lesson.outcome ? t(`outcome.${lesson.outcome}`) : t('notMentioned'),
          })}
        </span>
        {showProgress ? (
          <Badge tone={lesson.progress === 'completed' ? 'success' : 'neutral'}>
            {t(`progress.${lesson.progress ?? 'none'}`)}
          </Badge>
        ) : null}
      </p>
      {lesson.note ? (
        <div className="rounded-lg bg-slate-50 p-2 text-sm">
          <p className="font-medium text-slate-700">{t('lessonNoteLabel')}</p>
          <TypedText text={lesson.note} className="text-slate-800" />
        </div>
      ) : null}
    </div>
  );
}

/** The report's lessons, read-only (a confirmed report, or the direction's view). */
export function ReportLessonList({
  lessons,
  locale,
  showProgress,
}: {
  lessons: ReportLessonView[];
  locale: string;
  showProgress: boolean;
}) {
  return (
    <ol className="space-y-3">
      {lessons.map((lesson) => (
        <li
          key={lesson.lessonId}
          data-testid="confirm-lesson"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <ReportLessonHeader lesson={lesson} locale={locale} showProgress={showProgress} />
        </li>
      ))}
    </ol>
  );
}

/** Absent students, behaviour and the notes for the teacher (decrypted on the server). */
export function ReportNotes({ report }: { report: ReportView }) {
  const t = useTranslations('subReport');
  const section = (title: string, text: string | undefined) => (
    <section className="space-y-1">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {text ? (
        <TypedText text={text} className="text-sm text-slate-800" />
      ) : (
        <p className="text-sm text-slate-600">{t('noNotes')}</p>
      )}
    </section>
  );
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <section className="space-y-1">
        <h2 className="font-semibold text-slate-900">{t('absent')}</h2>
        {report.absent.length > 0 ? (
          <ul className="flex flex-wrap gap-2" data-testid="report-absent">
            {report.absent.map((s) => (
              <li key={s.id}>
                <Badge>{s.firstName}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('noneAbsent')}</p>
        )}
      </section>
      {report.notesState === 'purged' ? (
        <Notice>{t('notesPurged')}</Notice>
      ) : report.notesState === 'unreadable' ? (
        <Notice tone="warning">{t('notesUnreadableStaff')}</Notice>
      ) : (
        <>
          {section(t('behaviour'), report.notes?.behaviour || undefined)}
          {section(t('notes'), report.notes?.forTeacher || undefined)}
        </>
      )}
    </div>
  );
}
