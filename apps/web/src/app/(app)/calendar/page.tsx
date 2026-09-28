import { addDays, localDateIn } from '@lynx/domain';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { EventForm } from '@/components/calendar/event-form';
import { DeleteEventButton } from '@/components/calendar/delete-event-button';
import { Badge, Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { formatLocalDate, formatTime, formatTimeRange } from '@/lib/format';
import { hasRole, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('calendar');
  return { title: t('title') };
}

export default async function CalendarPage() {
  const session = await requireSession();
  const t = await getTranslations('calendar');
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const tz = session.schools[0]?.timezone ?? 'America/Toronto';
  const today = localDateIn(tz);

  const [eventsRes, classesRes] = await Promise.all([
    supabase
      .from('school_calendar_events')
      .select(
        'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, notes, classes(name)',
      )
      .gte('ends_on', today)
      .lte('starts_on', addDays(today, 180))
      .order('starts_on')
      .order('start_time', { nullsFirst: true }),
    supabase
      .from('class_teachers')
      .select('classes!inner(id, name, school_id)')
      .eq('user_id', session.userId),
  ]);

  const managedSchools = session.schools.filter((s) =>
    hasRole(s, 'principal', 'vice_principal', 'office_admin'),
  );
  const myClasses = (classesRes.data ?? []).map((r) => r.classes);
  const canManage = (e: { school_id: string | null; class_id: string | null }) =>
    e.school_id !== null &&
    (managedSchools.some((s) => s.id === e.school_id) ||
      (e.class_id !== null && myClasses.some((c) => c.id === e.class_id)));

  const scopes = [
    ...managedSchools.map((s) => ({
      key: `school:${s.id}`,
      schoolId: s.id,
      classId: null,
      label: `${t('scopeSchool')} · ${s.shortName ?? s.name}`,
    })),
    ...myClasses.map((c) => ({
      key: `class:${c.id}`,
      schoolId: c.school_id,
      classId: c.id,
      label: t('scopeClass', { name: c.name }),
    })),
  ];

  const events = eventsRes.data ?? [];
  const months = [
    ...new Set(events.map((e) => (e.starts_on < today ? today : e.starts_on).slice(0, 7))),
  ];

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={scopes.length ? <EventForm scopes={scopes} defaultDate={today} /> : null}
      />
      {events.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="space-y-6">
          {months.map((month) => (
            <section key={month}>
              <h2 className="mb-2 font-semibold text-slate-700 capitalize">
                {formatLocalDate(`${month}-01`, locale, { month: 'long', year: 'numeric' })}
              </h2>
              <ul className="space-y-2">
                {events
                  .filter((e) => (e.starts_on < today ? today : e.starts_on).startsWith(month))
                  .map((e) => (
                    <li key={e.id}>
                      <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-600">
                            {formatLocalDate(e.starts_on, locale)}
                            {e.ends_on !== e.starts_on
                              ? ` – ${formatLocalDate(e.ends_on, locale)}`
                              : ''}
                            {' · '}
                            {e.start_time && e.end_time
                              ? formatTimeRange(e.start_time, e.end_time, locale)
                              : e.start_time
                                ? t('from', { time: formatTime(e.start_time, locale) })
                                : e.end_time
                                  ? t('until', { time: formatTime(e.end_time, locale) })
                                  : t('allDay')}
                          </p>
                          <p className="font-medium">{e.title}</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Badge
                              tone={
                                e.event_type === 'pa_day' || e.event_type === 'holiday'
                                  ? 'warning'
                                  : 'brand'
                              }
                            >
                              {t(`types.${e.event_type}`)}
                            </Badge>
                            <Badge>
                              {e.school_id === null
                                ? t('scopeBoard')
                                : e.class_id
                                  ? t('scopeClass', { name: e.classes?.name ?? '' })
                                  : t('scopeSchool')}
                            </Badge>
                          </div>
                          {e.notes ? (
                            <p className="mt-2 text-sm text-slate-600">{e.notes}</p>
                          ) : null}
                        </div>
                        {canManage(e) ? <DeleteEventButton eventId={e.id} title={e.title} /> : null}
                      </Card>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
