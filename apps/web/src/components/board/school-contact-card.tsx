'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { updateSchoolContact } from '@/server/actions/school';

export interface SchoolContact {
  officePhone: string;
  officeEmail: string;
  dayStart: string;
  dayEnd: string;
}

/**
 * « Coordonnées et heures » (DECISIONS D-108): the office's phone and e-mail and the bell times,
 * for the school's direction (« École ») and the board's admins (« Conseil »). Merged into the
 * school's settings without touching the rest; what was typed stays after an error.
 */
export function SchoolContactCard({
  school,
  contact,
  canEdit,
  showName = false,
}: {
  school: { id: string; name: string };
  contact: SchoolContact;
  canEdit: boolean;
  /** The school's name in the title (on « École », which can list several schools). */
  showName?: boolean;
}) {
  const t = useTranslations('board.contact');
  const tCommon = useTranslations('common');
  const [officePhone, setOfficePhone] = useState(contact.officePhone);
  const [officeEmail, setOfficeEmail] = useState(contact.officeEmail);
  const [dayStart, setDayStart] = useState(contact.dayStart);
  const [dayEnd, setDayEnd] = useState(contact.dayEnd);
  const save = useAction(updateSchoolContact, { successMessage: t('saved') });
  const id = (field: string) => `contact-${field}-${school.id}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(school.id, { officePhone, officeEmail, dayStart, dayEnd });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{showName ? `${t('title')} · ${school.name}` : t('title')}</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">{t('intro')}</p>
          {!canEdit ? <p className="text-sm text-slate-500">{t('readOnly')}</p> : null}
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('officePhone')}
                htmlFor={id('phone')}
                hint={t('officePhoneHint')}
                error={save.fieldError('officePhone')}
              >
                <Input
                  id={id('phone')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={officePhone}
                  maxLength={40}
                  aria-invalid={Boolean(save.fieldError('officePhone'))}
                  onChange={(e) => setOfficePhone(e.target.value)}
                />
              </Field>
              <Field
                label={t('officeEmail')}
                htmlFor={id('email')}
                error={save.fieldError('officeEmail')}
              >
                <Input
                  id={id('email')}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={officeEmail}
                  maxLength={320}
                  aria-invalid={Boolean(save.fieldError('officeEmail'))}
                  onChange={(e) => setOfficeEmail(e.target.value)}
                />
              </Field>
              <Field
                label={t('dayStart')}
                htmlFor={id('start')}
                error={save.fieldError('dayStart')}
              >
                <Input
                  id={id('start')}
                  type="time"
                  value={dayStart}
                  onChange={(e) => setDayStart(e.target.value)}
                />
              </Field>
              <Field label={t('dayEnd')} htmlFor={id('end')} error={save.fieldError('dayEnd')}>
                <Input
                  id={id('end')}
                  type="time"
                  value={dayEnd}
                  onChange={(e) => setDayEnd(e.target.value)}
                />
              </Field>
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={save.pending}>
                  {save.pending ? tCommon('saving') : tCommon('save')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        </form>
      </CardBody>
    </Card>
  );
}
