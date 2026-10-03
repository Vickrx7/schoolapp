-- « Info-parents », slice S1: the class's weekly message to families (DECISIONS D-136 to D-138;
-- amends D-105).
-- Tests: supabase/tests/36_class_newsletters.test.sql
--
-- 1. `class_newsletters`: one message per class and week (`week_of`, a Monday), the class team's
--    (`app.my_class_ids()`: a current teacher role at the class's school; never the direction,
--    the office, the board's admins, a removed member or a deactivated account). The app drafts
--    it from the class's own data, the teacher edits it, then copies or prints it: the app sends
--    nothing to families and stores no parent data (D-136). Its content (`{v: 1, signature,
--    sections: [{key, off, items: [{id, fr, en, enFrom, enBy, from}]}]}`) is checked by the app
--    (@lynx/domain `newsletterContentSchema`); the database checks its kind and size, as for
--    plans (D-048, D-137). Saving is a direct update on the expected `revision` (zero rows: the
--    app says « modifié par une ou un collègue »). Status `draft` or `sent` (« Marquer comme
--    envoyé »), `sent_at` set by the database.
-- 2. `app.class_newsletters_before_write()`: a new message's week must touch the class's school
--    year (LXN01) and its class must still have its students (LXN02); the database sets
--    `revision`, `status`, `sent_at`, `created_by` and `updated_by`. A content change bumps the
--    revision.
-- 3. `app.purge_class_students` (amends D-105): also deletes the class's messages, and its audit
--    details count them (`newsletters`, when there were some). Nothing can be added after a
--    purge (LXN02), so the nightly job's « came back after a purge » clause stays as it is.
-- No event, no audit: drafting a message is a teacher's private professional activity (D-024,
-- D-103). Retention (D-105, D-138): with the class (cascade), the sample class, the board, or
-- the class purge (a year after the school year by default).
--
-- Error codes: LXN01 week outside the class's school year; LXN02 the class's students were
-- purged. (LXN03 to LXN06 come with « Traduire en anglais (IA) », slice S3.)

-- ---------------------------------------------------------------------------------------
-- 1. The table (D-136, D-137)
-- ---------------------------------------------------------------------------------------

create table public.class_newsletters (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  -- The week's Monday.
  week_of date not null check (extract(isodow from week_of) = 1),
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and content ->> 'v' = '1'
    and jsonb_typeof(content -> 'sections') = 'array'
    and pg_column_size(content) <= 65536
  ),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at timestamptz,
  revision integer not null default 1,
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Also the index of the class's foreign key.
  unique (class_id, week_of),
  check ((status = 'sent') = (sent_at is not null))
);

create index class_newsletters_created_by_idx on public.class_newsletters (created_by);
create index class_newsletters_updated_by_idx on public.class_newsletters (updated_by);

alter table public.class_newsletters enable row level security;
revoke all on public.class_newsletters from anon, authenticated;

create policy class_newsletters_team on public.class_newsletters
  for all to authenticated
  using (class_id in (select app.my_class_ids()))
  with check (class_id in (select app.my_class_ids()));

grant select, delete on public.class_newsletters to authenticated;
grant insert (class_id, week_of, content) on public.class_newsletters to authenticated;
grant update (content, status) on public.class_newsletters to authenticated;

create trigger class_newsletters_touch before update on public.class_newsletters
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- 2. What the database sets (D-137, D-138)
-- ---------------------------------------------------------------------------------------

-- A signed-in user outside the class team learns nothing here: the row goes on and row level
-- security refuses it (42501). The worker (no signed-in user, slice S3) passes the person it
-- writes for in `updated_by`.
create function app.class_newsletters_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts date;
  v_ends date;
  v_purged timestamptz;
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null
       and new.class_id not in (select app.my_class_ids()) then
      return new;
    end if;
    select y.starts_on, y.ends_on, c.students_purged_at into v_starts, v_ends, v_purged
    from public.classes c left join public.school_years y on y.id = c.school_year_id
    where c.id = new.class_id;
    if v_purged is not null then
      raise exception 'the class''s students were purged' using errcode = 'LXN02';
    end if;
    -- A week that touches the year (its Friday on or after the first day, its Monday on or
    -- before the last).
    if v_starts is not null
       and (new.week_of + 4 < v_starts or new.week_of > v_ends) then
      raise exception 'the week lies outside the class''s school year' using errcode = 'LXN01';
    end if;
    new.revision := 1;
    new.status := 'draft';
    new.sent_at := null;
    new.created_by := app.active_user_id();
    new.updated_by := new.created_by;
    return new;
  end if;

  if new.content is distinct from old.content then
    new.revision := old.revision + 1;
    new.updated_by := coalesce(app.active_user_id(), new.updated_by);
  else
    new.revision := old.revision;
  end if;
  if new.status is distinct from old.status then
    new.sent_at := case when new.status = 'sent' then now() end;
  end if;
  return new;
end;
$$;

create trigger class_newsletters_before_write
  before insert or update on public.class_newsletters
  for each row execute function app.class_newsletters_before_write();

-- ---------------------------------------------------------------------------------------
-- 3. The year-end purge (D-105 as amended by D-138)
-- ---------------------------------------------------------------------------------------

-- As in 20261201090500_phase6_review_fixes.sql, plus the class's « Info-parents » messages,
-- counted in the audit entry's details (`newsletters`). The signature is unchanged, so
-- `app.retention_maintenance()` needs no change.
create or replace function app.purge_class_students(p_class_id uuid, out students_deleted integer,
  out plans_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes;
  v_board uuid;
  v_year_ends date;
  v_newsletters integer;
  r record;
begin
  students_deleted := 0;
  plans_deleted := 0;
  select * into v_class from public.classes c where c.id = p_class_id for update;
  if not found then
    return;
  end if;
  select s.board_id into v_board from public.schools s where s.id = v_class.school_id;
  select y.ends_on into v_year_ends from public.school_years y where y.id = v_class.school_year_id;
  for r in
    select distinct spc.sub_plan_id
    from public.sub_plan_classes spc
    join public.sub_plans p on p.id = spc.sub_plan_id
    where spc.class_id = p_class_id and p.plan_date <= v_year_ends
  loop
    if app.purge_sub_plan(r.sub_plan_id, 'class_retention') then
      plans_deleted := plans_deleted + 1;
    end if;
  end loop;
  delete from public.sub_plan_classes spc where spc.class_id = p_class_id;
  delete from public.class_mode_links l where l.class_id = p_class_id;
  delete from public.class_newsletters n where n.class_id = p_class_id;
  get diagnostics v_newsletters = row_count;
  delete from public.students st where st.class_id = p_class_id;
  get diagnostics students_deleted = row_count;
  update public.classes c set students_purged_at = now() where c.id = p_class_id;
  -- The count of messages only when there were some: a class that never used « Info-parents »
  -- keeps the entry it always had.
  perform app.log_audit('class.students_purged', v_board, v_class.school_id, 'class', p_class_id,
    jsonb_build_object('students', students_deleted)
      || case when v_newsletters > 0 then jsonb_build_object('newsletters', v_newsletters)
              else '{}'::jsonb end);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Permissions
-- ---------------------------------------------------------------------------------------

-- Trigger functions: never called directly. The purge keeps its grants (the owner only).
revoke execute on function app.class_newsletters_before_write() from public, anon, authenticated;
