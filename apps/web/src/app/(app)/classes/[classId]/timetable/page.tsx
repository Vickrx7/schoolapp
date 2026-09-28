import { findOverlaps, timeToMinutes } from '@lynx/domain';
import { getLocale, getTranslations } from 'next-intl/server';
import { TimetableBoard } from '@/components/timetable/timetable-board';
import { Notice } from '@/components/ui/card';
import { toTimetableBlock } from '@/server/queries/mappers';
import { loadClass } from '@/server/queries/classes';
import { loadSubjectsForGrades } from '@/server/queries/subjects';
import { findSchool, requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

export default async function TimetablePage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await requireSession();
  const cls = (await loadClass(session, classId))!;
  const school = findSchool(session, cls.schoolId)!;
  const board = session.boards.find((b) => b.id === school.boardId);
  const t = await getTranslations('timetable');
  const supabase = await createSupabaseServerClient();

  const [blocksRes, roomsRes, subjects] = await Promise.all([
    supabase
      .from('timetable_blocks')
      .select(
        'id, class_id, day_key, start_time, end_time, kind, subject_id, title, teacher_id, room_id, notes',
      )
      .eq('class_id', classId),
    supabase.from('rooms').select('id, name').eq('school_id', school.id).order('name'),
    loadSubjectsForGrades(cls.gradeOrdinals, board?.settings, await getLocale()),
  ]);

  const rows = blocksRes.data ?? [];
  const blocks = rows
    .map((r) => ({ ...toTimetableBlock(r), notes: r.notes }))
    .sort((a, b) => a.dayKey - b.dayKey || timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const overlapping = new Set(findOverlaps(blocks).flat());
  const dayCount = school.scheduleType === 'cycle' && school.cycleLength ? school.cycleLength : 5;

  return (
    <div className="space-y-4">
      {school.scheduleType === 'cycle' && school.cycleLength ? (
        <Notice>{t('cycleNotice', { n: school.cycleLength })}</Notice>
      ) : null}
      <TimetableBoard
        classId={classId}
        scheduleType={school.scheduleType}
        dayCount={dayCount}
        blocks={blocks.map((b) => ({ ...b, overlaps: overlapping.has(b.id) }))}
        subjects={subjects}
        team={cls.team.map((m) => ({ id: m.userId, name: m.name }))}
        rooms={roomsRes.data ?? []}
        defaults={{ start: school.settings.dayStart, end: school.settings.dayEnd }}
      />
    </div>
  );
}
