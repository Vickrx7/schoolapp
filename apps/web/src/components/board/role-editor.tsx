'use client';

import { staffRoles, type StaffRole } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { grantRole, revokeRole } from '@/server/actions/board';

export interface EditableRole {
  id: string;
  role: string;
  /** « Enseignant·e · É.É.C. Saint-Exemple » */
  label: string;
}

/**
 * A person's roles in the board (DECISIONS D-107): « Retirer ce rôle » (the database refuses a
 * person's last role, « Retirez plutôt l'accès de cette personne », and the board's last admin)
 * and « Ajouter un rôle » (never to oneself). Removing a teacher role warns that the person's
 * classes there stay out of reach until a teacher role comes back.
 */
export function RoleEditor({
  name,
  roles,
  schools,
  canAdd,
}: {
  name: string;
  roles: EditableRole[];
  schools: { id: string; name: string }[];
  /** False on one's own page (LXU07). */
  canAdd: boolean;
}) {
  const t = useTranslations('board.person');
  const tInvite = useTranslations('board.invite');
  const tRoles = useTranslations('profile.roleNames');
  const [role, setRole] = useState<StaffRole>('teacher');
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0]!.id : '');
  const revoke = useAction(revokeRole, { successMessage: t('roleRemoved') });
  const grant = useAction(grantRole, { successMessage: t('roleAdded') });
  const anyRole = roles[0]?.id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!anyRole) return;
    void grant.run(anyRole, {
      role,
      schoolId: role === 'board_admin' || !schoolId ? null : schoolId,
    });
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-100">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-slate-900">{r.label}</span>
            <ConfirmButton
              label={`${t('removeRole')} : ${r.label}`}
              message={
                <>
                  {t('removeRoleConfirm', { role: r.label, name })}
                  {r.role === 'teacher' ? (
                    <span className="mt-2 block text-sm text-slate-600">
                      {t('removeTeacherWarning')}
                    </span>
                  ) : null}
                </>
              }
              confirmLabel={t('removeRole')}
              size="md"
              onConfirm={() => revoke.run(r.id)}
            >
              {t('removeRole')}
            </ConfirmButton>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <form onSubmit={submit} className="space-y-3 rounded-lg bg-slate-50 p-3" noValidate>
          <p className="font-medium text-slate-900">{t('addRole')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tInvite('role')} htmlFor="role-new">
              <Select
                id="role-new"
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
              >
                {staffRoles.map((r) => (
                  <option key={r} value={r}>
                    {tRoles(r)}
                  </option>
                ))}
              </Select>
            </Field>
            {role !== 'board_admin' ? (
              <Field
                label={tInvite('school')}
                htmlFor="role-school"
                error={grant.fieldError('schoolId')}
              >
                <Select
                  id="role-school"
                  value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)}
                >
                  {schools.length !== 1 ? (
                    <option value="">{tInvite('chooseSchool')}</option>
                  ) : null}
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={grant.pending}>
              {t('addRole')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-600">{t('ownRoles')}</p>
      )}
    </div>
  );
}
