'use client';

import { staffRoles, type StaffRole } from '@lynx/domain';
import { UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import type { AppLocale } from '@/i18n/config';
import { inviteStaff } from '@/server/actions/board';

/**
 * « Inviter une personne » (DECISIONS D-107): within this board only (its schools, or the whole
 * board for an admin). The account is prepared by the worker; the next page gives the message the
 * inviter sends in the chosen language. What was typed stays while the dialog is closed and
 * reopened, and after an error.
 */
export function InviteDialog({
  boardId,
  schools,
  query,
}: {
  boardId: string;
  schools: { id: string; name: string }[];
  /** `?board=…` to keep on the next page, or empty. */
  query: string;
}) {
  const t = useTranslations('board.invite');
  const tRoles = useTranslations('profile.roleNames');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [honorific, setHonorific] = useState('');
  const [role, setRole] = useState<StaffRole>('teacher');
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0]!.id : '');
  const [language, setLanguage] = useState<AppLocale>(locale);

  const invite = useAction(inviteStaff, {
    onSuccess: (result) => {
      const extra = query ? `&${query.slice(1)}` : '';
      router.push(`/board/staff/invitations/${result.invitationId}?lang=${language}${extra}`);
      setOpen(false);
      setEmail('');
      setName('');
      setHonorific('');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void invite.run({
      boardId,
      schoolId: role === 'board_admin' || !schoolId ? null : schoolId,
      email,
      displayName: name,
      honorific,
      role,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('title')} description={t('intro')} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t('email')} htmlFor="invite-email" error={invite.fieldError('email')}>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              maxLength={320}
              aria-invalid={Boolean(invite.fieldError('email'))}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field
              label={t('honorific')}
              htmlFor="invite-honorific"
              error={invite.fieldError('honorific')}
            >
              <Input
                id="invite-honorific"
                value={honorific}
                maxLength={20}
                autoComplete="off"
                onChange={(e) => setHonorific(e.target.value)}
              />
            </Field>
            <Field label={t('name')} htmlFor="invite-name" error={invite.fieldError('displayName')}>
              <Input
                id="invite-name"
                value={name}
                maxLength={120}
                autoComplete="off"
                aria-invalid={Boolean(invite.fieldError('displayName'))}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('role')} htmlFor="invite-role">
            <Select
              id="invite-role"
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
              label={t('school')}
              htmlFor="invite-school"
              error={invite.fieldError('schoolId')}
            >
              <Select
                id="invite-school"
                value={schoolId}
                aria-invalid={Boolean(invite.fieldError('schoolId'))}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                {schools.length !== 1 ? <option value="">{t('chooseSchool')}</option> : null}
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t('language')} htmlFor="invite-language">
            <Select
              id="invite-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLocale)}
            >
              <option value="fr-CA" lang="fr">
                {t('french')}
              </option>
              <option value="en-CA" lang="en">
                {t('english')}
              </option>
            </Select>
          </Field>
          {invite.error && Object.keys(invite.fieldErrors).length === 0 ? (
            <Notice tone="danger">{invite.errorText}</Notice>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={invite.pending}>
              {invite.pending ? t('submitting') : t('submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
