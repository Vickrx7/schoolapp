-- Review C (2026-10-07): three gaps found in the review before merging.
--
-- 1. A plan that stopped following its sources.
--
-- app.mark_absence_stale wakes the worker only when an absence's mark was clear. If the worker's
-- `sub_plan_refresh` job used up its attempts (a source that fails to parse, a plan past its
-- size limit), the mark stayed set: later changes woke nobody, the page showed the rebuild
-- spinner for good and the substitute got the stale plan at 07:30. The worker now sweeps every
-- 15 minutes and wakes itself again for an absence still marked after 30 minutes, at most once
-- an hour per absence, until the absence ends.

create function app.sweep_stale_absences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select a.id, a.school_id, s.board_id
    from public.absences a
    join public.schools s on s.id = a.school_id
    where a.status = 'published'
      and a.sources_changed_at < now() - interval '30 minutes'
      and a.ends_on >= app.school_local_today(a.school_id)
      and not exists (
        select 1 from public.event_outbox o
        where o.event_type = 'absence.sources_changed'
          and o.aggregate_id = a.id
          and o.occurred_at > now() - interval '1 hour'
      )
  loop
    perform app.emit_event('absence.sources_changed', r.board_id, r.school_id, 'absence', r.id,
      jsonb_build_object('absenceId', r.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function app.sweep_stale_absences() from public, anon, authenticated;
grant execute on function app.sweep_stale_absences() to service_role;

create index event_outbox_absence_sources_idx on public.event_outbox (aggregate_id, occurred_at)
  where event_type = 'absence.sources_changed';

-- 2. A school year's end decides when its students' first names are purged (D-105: 365 days
--    after it ends, a setting only the operator changes). Through the API, a board admin could
--    move a past year's end years ahead and keep its classes' names indefinitely. A year now lasts at
--    most 400 days, and once a year has ended, the API cannot move its end later (earlier
--    is fine: it only brings the purge forward). The operator, as the database owner, still can.

alter table public.school_years
  add constraint school_years_length_check check (ends_on - starts_on <= 400);

create function app.school_years_guard_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.ends_on > old.ends_on
     and old.ends_on < current_date then
    raise exception 'a past school year cannot end later' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger school_years_guard_end
  before update of ends_on on public.school_years
  for each row execute function app.school_years_guard_end();

revoke execute on function app.school_years_guard_end() from public, anon, authenticated;

-- 3. feedback_student_names answers « which of these words are first names of students of my
--    schools » for staff who may not read students (the office, D-116). Fed lists of common
--    names, it could reveal a school's roster. Feedback is rare: each person may now ask 20
--    times in 24 hours, which is far above any real use and far below a useful enumeration.

create table app.feedback_name_checks (
  user_id uuid not null,
  checked_at timestamptz not null default now()
);
create index feedback_name_checks_user_idx on app.feedback_name_checks (user_id, checked_at);
alter table app.feedback_name_checks enable row level security;
revoke all on app.feedback_name_checks from public, anon, authenticated;

create or replace function public.feedback_student_names(p_text text)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_text text := app.fold_letters(coalesce(p_text, ''));
begin
  if v_user is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(p_text) > 4000 then
    raise exception 'text too long' using errcode = '22023';
  end if;
  delete from app.feedback_name_checks where checked_at < now() - interval '24 hours';
  if (select count(*) from app.feedback_name_checks where user_id = v_user) >= 20 then
    raise exception 'too many checks' using errcode = '54000';
  end if;
  insert into app.feedback_name_checks (user_id) values (v_user);
  return query
    select distinct st.first_name
    from public.students st
    join public.classes c on c.id = st.class_id
    where c.school_id in (select app.my_staff_school_ids())
      and char_length(app.fold_letters(st.first_name)) >= 2
      and position(app.fold_letters(st.first_name) in v_text) > 0;
end;
$$;

revoke execute on function public.feedback_student_names(text) from public, anon;
grant execute on function public.feedback_student_names(text) to authenticated;
