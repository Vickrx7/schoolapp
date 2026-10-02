import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { PendingInvitation, StaffPerson, StaffRoleRow } from '@/server/queries/board';
import { StaffStatusBadge } from './staff-status';

type RoleLabel = (role: StaffRoleRow) => string;

async function roleLabeler(): Promise<RoleLabel> {
  const t = await getTranslations('board.staff');
  const tRoles = await getTranslations('profile.roleNames');
  return (r) =>
    t('roleAt', {
      role: tRoles(r.role),
      place: r.schoolName ?? t('wholeBoard'),
    });
}

/**
 * « Personnel »: everyone with a role in the board. Cards on phones, a table from `md:`; each name
 * opens the person's page.
 */
export async function StaffList({ people, query }: { people: StaffPerson[]; query: string }) {
  const t = await getTranslations('board.staff');
  const label = await roleLabeler();
  const href = (p: StaffPerson) => `/board/staff/${p.userId}${query}`;
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {people.map((p) => (
          <li key={p.userId}>
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link
                  href={href(p)}
                  className="inline-flex min-h-11 items-center font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  {p.displayName}
                </Link>
                <StaffStatusBadge status={p.status} />
              </div>
              <p className="text-sm break-all text-slate-600">{p.email}</p>
              <ul className="text-sm text-slate-700">
                {p.roles.map((r) => (
                  <li key={r.id}>{label(r)}</li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('name')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('email')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('roles')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t('status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => (
              <tr key={p.userId} className="align-top">
                <td className="px-4 py-2">
                  <Link
                    href={href(p)}
                    className="inline-flex min-h-11 items-center font-medium text-brand-700 underline-offset-2 hover:underline"
                  >
                    {p.displayName}
                  </Link>
                </td>
                <td className="px-4 py-3 break-all text-slate-600">{p.email}</td>
                <td className="px-4 py-3 text-slate-700">
                  <ul>
                    {p.roles.map((r) => (
                      <li key={r.id}>{label(r)}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3">
                  <StaffStatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/** Invitations being prepared, and those that failed this month. */
export async function InvitationList({
  invitations,
  query,
}: {
  invitations: PendingInvitation[];
  query: string;
}) {
  const t = await getTranslations('board.staff');
  const tRoles = await getTranslations('profile.roleNames');
  return (
    <ul className="space-y-2">
      {invitations.map((i) => (
        <li key={i.id}>
          <Link
            href={`/board/staff/invitations/${i.id}${query}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
          >
            <span className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-medium text-slate-900">{i.displayName}</span>
              <StaffStatusBadge status={i.status} />
            </span>
            <span className="block text-sm break-all text-slate-600">{i.email}</span>
            <span className="block text-sm text-slate-700">
              {t('roleAt', { role: tRoles(i.role), place: i.schoolName ?? t('wholeBoard') })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
