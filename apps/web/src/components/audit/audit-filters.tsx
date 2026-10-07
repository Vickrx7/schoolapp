'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/field';
import {
  auditHref,
  toAuditSearchParams,
  type AuditCategory,
  type AuditFilters,
  type AuditScope,
} from '@/server/audit/filters';
import { AUDIT_ACTOR_TYPES } from '@/server/audit/rows';

export interface ScopeOption {
  scope: AuditScope;
  label: string;
}

export interface AuditFilterOptions {
  filters: AuditFilters;
  /** Every school the person directs and board they administer (a choice when more than one). */
  scopes: ScopeOption[];
  /** In a board's view: its schools, to narrow to one. */
  boardSchools: { id: string; name: string }[];
  people: { id: string; name: string }[];
  categories: AuditCategory[];
  /** The scope with no other filter. */
  clearHref: string;
}

const scopeKey = (scope: AuditScope) =>
  scope.kind === 'school' ? `school:${scope.schoolId}` : `board:${scope.boardId}`;

/**
 * The filters of « Journal d'audit » (DECISIONS D-103) as a GET form: its fields are the address's
 * parameters, so the server reads them back (`parseAuditFilters`). Changing the scope opens it at
 * once (its people and categories differ); the rest applies with « Afficher ».
 */
function FilterForm({
  filters,
  scopes,
  boardSchools,
  people,
  categories,
  clearHref,
  onDone,
}: AuditFilterOptions & { onDone?: () => void }) {
  const t = useTranslations('audit');
  const tf = useTranslations('audit.filters');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();
  const go = (href: string) => {
    onDone?.();
    startTransition(() => router.push(href));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value.trim() !== '') params.set(key, value.trim());
    }
    go(`/audit?${params.toString()}`);
  };

  const changeScope = (value: string) => {
    const option = scopes.find((s) => scopeKey(s.scope) === value);
    if (!option) return;
    go(
      auditHref(filters, {
        scope: option.scope,
        category: null,
        actor: null,
        type: null,
        entity: null,
      }),
    );
  };

  const personOptions =
    filters.actor && !people.some((p) => p.id === filters.actor)
      ? [...people, { id: filters.actor, name: tf('otherPerson') }]
      : people;
  const shownCategories =
    filters.category && !categories.includes(filters.category)
      ? [...categories, filters.category]
      : categories;

  return (
    <form
      // A new address (back, a link) shows its own values.
      key={toAuditSearchParams(filters).toString()}
      method="get"
      action="/audit"
      onSubmit={submit}
      className="space-y-4"
      aria-busy={pending}
    >
      {filters.scope.kind === 'school' ? (
        <input type="hidden" name="school" value={filters.scope.schoolId} />
      ) : (
        <input type="hidden" name="board" value={filters.scope.boardId} />
      )}
      {filters.entity ? <input type="hidden" name="entity" value={filters.entity} /> : null}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {scopes.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-scope`}>{tf('scope')}</Label>
            <Select
              id={`${id}-scope`}
              defaultValue={scopeKey(filters.scope)}
              onChange={(e) => changeScope(e.target.value)}
            >
              {scopes.map((s) => (
                <option key={scopeKey(s.scope)} value={scopeKey(s.scope)}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {filters.scope.kind === 'board' && boardSchools.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-school`}>{tf('school')}</Label>
            <Select id={`${id}-school`} name="school" defaultValue={filters.scope.schoolId ?? ''}>
              <option value="">{tf('anySchool')}</option>
              {boardSchools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <fieldset className="space-y-1.5 md:col-span-2 lg:col-span-1">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{tf('period')}</legend>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-from`} className="font-normal text-slate-600">
                {tf('from')}
              </Label>
              <Input
                id={`${id}-from`}
                type="date"
                name="from"
                defaultValue={filters.from}
                max={filters.to}
                aria-describedby={`${id}-period-hint`}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-to`} className="font-normal text-slate-600">
                {tf('to')}
              </Label>
              <Input
                id={`${id}-to`}
                type="date"
                name="to"
                defaultValue={filters.to}
                aria-describedby={`${id}-period-hint`}
              />
            </div>
          </div>
          <p id={`${id}-period-hint`} className="text-sm text-slate-500">
            {tf('periodHint')}
          </p>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-category`}>{tf('category')}</Label>
          <Select id={`${id}-category`} name="category" defaultValue={filters.category ?? ''}>
            <option value="">{tf('anyCategory')}</option>
            {shownCategories.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-actor`}>{tf('person')}</Label>
          <Select id={`${id}-actor`} name="actor" defaultValue={filters.actor ?? ''}>
            <option value="">{tf('anyPerson')}</option>
            {personOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>{tf('type')}</Label>
          <Select id={`${id}-type`} name="type" defaultValue={filters.type ?? ''}>
            <option value="">{tf('anyType')}</option>
            {AUDIT_ACTOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`actorTypes.${type}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-busy={pending}>
          {tf('apply')}
        </Button>
        <Button asChild variant="ghost">
          <Link href={clearHref} onClick={() => onDone?.()}>
            {tf('clear')}
          </Link>
        </Button>
      </div>
    </form>
  );
}

/**
 * The filters: a card above the entries from `md:`, and on phones a « Filtres » button (with the
 * number of filters set) that opens them in a bottom sheet.
 */
export function AuditFilterPanel({ count, ...options }: AuditFilterOptions & { count: number }) {
  const tf = useTranslations('audit.filters');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="hidden p-4 md:block">
        <FilterForm {...options} />
      </Card>
      <div className="md:hidden">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">
              <SlidersHorizontal aria-hidden />
              {count ? tf('openCount', { count }) : tf('open')}
            </Button>
          </DialogTrigger>
          <DialogContent title={tf('title')} closeLabel={tf('close')}>
            <FilterForm {...options} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
