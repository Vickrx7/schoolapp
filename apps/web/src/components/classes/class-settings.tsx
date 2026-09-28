'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { addClassTeacher, deleteClass, removeClassTeacher } from '@/server/actions/classes';
import type { ClassFormOptions } from '@/server/queries/classes';
import { ClassForm } from './class-form';

type Role = 'homeroom' | 'subject' | 'support';

export function ClassSettings({
  classId,
  className,
  isHomeroom,
  currentUserId,
  options,
  initial,
  team,
  candidates,
}: {
  classId: string;
  className: string;
  isHomeroom: boolean;
  currentUserId: string;
  options: ClassFormOptions;
  initial: { name: string; schoolId: string; roomId: string | null; gradeCodes: string[] };
  team: { userId: string; name: string; role: Role }[];
  candidates: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [candidate, setCandidate] = useState('');
  const [role, setRole] = useState<Role>('subject');
  const [confirmName, setConfirmName] = useState('');
  const add = useAction(addClassTeacher, {
    successMessage: t('common.saved'),
    onSuccess: () => setCandidate(''),
  });
  const remove = useAction(removeClassTeacher, { successMessage: t('common.saved') });
  const destroy = useAction(deleteClass, {
    successMessage: t('classes.deleted'),
    onSuccess: () => router.push('/classes'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('classes.tabs.settings')}</CardTitle>
        </CardHeader>
        <CardBody>
          <ClassForm
            options={options}
            initial={initial}
            classId={classId}
            onDone={() => router.refresh()}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('classes.team')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">{t('classes.teamHelp')}</p>
          <ul className="divide-y divide-slate-100">
            {team.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {m.name}{' '}
                  <span className="text-sm text-slate-500">· {t(`classes.role.${m.role}`)}</span>
                </span>
                {(isHomeroom || m.userId === currentUserId) && team.length > 1 ? (
                  <ConfirmButton
                    label={t('common.delete')}
                    message={t('classes.removeFromTeam', { name: m.name })}
                    confirmLabel={t('common.confirm')}
                    variant="ghost"
                    onConfirm={() => remove.run(classId, m.userId)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {isHomeroom && candidates.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label={t('classes.addTeacher')}
                htmlFor="team-candidate"
                className="flex-1 basis-48"
              >
                <Select
                  id="team-candidate"
                  value={candidate}
                  onChange={(e) => setCandidate(e.target.value)}
                >
                  <option value="">—</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('classes.teamRole')} htmlFor="team-role" className="basis-44">
                <Select
                  id="team-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {(['subject', 'support', 'homeroom'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`classes.role.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={!candidate || add.pending}
                onClick={() => void add.run(classId, { userId: candidate, role })}
              >
                {t('common.add')}
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {isHomeroom ? (
        <Card className="border-red-200 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-red-800">{t('classes.deleteTitle')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-700">{t('classes.deleteHelp')}</p>
            <Field label={t('classes.name')} htmlFor="confirm-class-name" className="max-w-sm">
              <Input
                id="confirm-class-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Button
              variant="danger"
              disabled={confirmName.trim() !== className || destroy.pending}
              onClick={() => void destroy.run(classId)}
            >
              {t('classes.deleteTitle')}
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
