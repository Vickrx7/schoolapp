'use client';

import { Eye, EyeOff, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/page';
import { useAction } from '@/hooks/use-action';
import {
  deleteStudent,
  revealClassAlerts,
  updateStudent,
  type StudentAlertView,
} from '@/server/actions/students';
import { AddStudentsDialog } from './add-students-dialog';
import { AlertEditor } from './alert-editor';

export interface StudentItem {
  id: string;
  firstName: string;
  levelId: string | null;
  active: boolean;
}

export function StudentsManager({
  classId,
  students,
  levels,
  alertsAvailable,
}: {
  classId: string;
  students: StudentItem[];
  levels: { id: string; label: string }[];
  alertsAvailable: boolean;
}) {
  const t = useTranslations('students');
  const [alerts, setAlerts] = useState<StudentAlertView[] | null>(null);
  const reveal = useAction(revealClassAlerts, { onSuccess: (data) => setAlerts(data) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t('title')}{' '}
          <span className="font-normal text-slate-500">
            ({students.filter((s) => s.active).length})
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {alertsAvailable ? (
            alerts ? (
              <Button variant="secondary" onClick={() => setAlerts(null)}>
                <EyeOff aria-hidden />
                {t('alerts.title')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void reveal.run(classId)}
                disabled={reveal.pending}
              >
                <Eye aria-hidden />
                {t('alerts.title')}
              </Button>
            )
          ) : null}
          <AddStudentsDialog classId={classId} existingNames={students.map((s) => s.firstName)} />
        </div>
      </div>

      {alerts ? <p className="text-sm text-slate-600">{t('alerts.help')}</p> : null}

      {students.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {students.map((s) => (
              <StudentRow
                key={s.id}
                classId={classId}
                student={s}
                levels={levels}
                alerts={alerts?.filter((a) => a.studentId === s.id) ?? null}
                onAlertsChanged={() => void reveal.run(classId)}
              />
            ))}
          </ul>
        </Card>
      )}
      <p className="text-sm text-slate-500">{t('defaultLevelHint')}</p>
    </div>
  );
}

function StudentRow({
  classId,
  student,
  levels,
  alerts,
  onAlertsChanged,
}: {
  classId: string;
  student: StudentItem;
  levels: { id: string; label: string }[];
  alerts: StudentAlertView[] | null;
  onAlertsChanged: () => void;
}) {
  const t = useTranslations('students');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(student.firstName);
  const update = useAction(updateStudent);
  const remove = useAction(deleteStudent, { successMessage: t('deleted') });

  const saveName = () => {
    if (name.trim() && name.trim() !== student.firstName)
      void update.run(classId, student.id, { firstName: name });
  };

  return (
    <li className={student.active ? 'p-3' : 'bg-slate-50 p-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('firstName')}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 basis-40"
          aria-invalid={update.error ? true : undefined}
        />
        <Select
          aria-label={t('defaultLevel')}
          value={student.levelId ?? ''}
          onChange={(e) =>
            void update.run(classId, student.id, { defaultLanguageLevelId: e.target.value || null })
          }
          className="w-auto basis-44"
        >
          <option value="">{t('noLevel')}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        {!student.active ? <Badge>{t('inactive')}</Badge> : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void update.run(classId, student.id, { active: !student.active })}
        >
          {student.active ? t('deactivate') : t('reactivate')}
        </Button>
        <ConfirmButton
          label={tCommon('delete')}
          message={t('deleteConfirm', { name: student.firstName })}
          confirmLabel={tCommon('delete')}
          variant="ghost"
          size="icon"
          onConfirm={() => remove.run(classId, student.id)}
        >
          <Trash2 aria-hidden />
        </ConfirmButton>
      </div>
      {alerts ? (
        <div className="mt-2 space-y-2 pl-1">
          {alerts.map((a) => (
            <div key={a.alertId} className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
              <AlertEditor
                classId={classId}
                studentId={student.id}
                alert={a}
                onChanged={onAlertsChanged}
              />
            </div>
          ))}
          <AlertEditor classId={classId} studentId={student.id} onChanged={onAlertsChanged} />
        </div>
      ) : null}
    </li>
  );
}
