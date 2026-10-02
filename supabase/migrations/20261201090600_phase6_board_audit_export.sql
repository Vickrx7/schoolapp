-- Phase 6 review fixes, round B: the end of a contract (DECISIONS D-122).
-- Tests: supabase/tests/33_board_audit_export.test.sql
--
-- A board admin's « Journal d'audit » shows the administrative entries only, a year per file
-- (D-103), and `delete-board` deletes every entry of the board. So the operator exports the whole
-- log first, for the board's records:
-- 1. `operator_export_audit(board, after_id, limit)`: every entry of the board and its schools,
--    every audience and date, oldest first, a page at a time (the API returns at most 1,000 rows),
--    with the school's and the acting person's names (a board's records outlive its accounts).
-- 2. `operator_log_audit_export(board, last_id, rows)`: once the file is written, records it
--    (`audit_log.operator_exported {rows, last_id}`, read by the board's admins), after checking
--    that the file holds every entry up to `last_id`.
-- 3. `operator_delete_board` refuses (LXB01) unless such an export was recorded in the last 7
--    days, and returns how many entries were written after it (`auditRowsSinceExport`): they are
--    not in the file.

insert into public.audit_action_catalog (action, category, audience) values
  ('audit_log.operator_exported', 'audit', 'board');

-- ---------------------------------------------------------------------------------------
-- 1. The whole log of a board
-- ---------------------------------------------------------------------------------------

create function public.operator_export_audit(p_board_id uuid, p_after_id bigint default 0,
  p_limit integer default 1000)
returns table (
  id bigint,
  occurred_at timestamptz,
  action text,
  audience text,
  category text,
  school_id uuid,
  school_name text,
  actor_type public.audit_actor_type,
  actor_user_id uuid,
  actor_name text,
  entity_type text,
  entity_id uuid,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_schools uuid[];
begin
  if not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'no such board' using errcode = '22023';
  end if;
  if p_after_id is null or p_after_id < 0 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'after_id from 0, limit 1 to 1000' using errcode = '22023';
  end if;
  v_schools := array(select s.id from public.schools s where s.board_id = p_board_id);
  return query
  select a.id, a.occurred_at, a.action, c.audience, c.category, a.school_id, s.name,
    a.actor_type, a.actor_user_id, u.display_name, a.entity_type, a.entity_id, a.details
  from public.audit_log a
  left join public.audit_action_catalog c on c.action = a.action
  left join public.schools s on s.id = a.school_id
  left join public.users u on u.id = a.actor_user_id
  where (a.board_id = p_board_id or a.school_id = any (v_schools))
    and a.id > p_after_id
  order by a.id
  limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Recording the export
-- ---------------------------------------------------------------------------------------

-- `p_rows` must be the number of the board's entries up to `p_last_id` (0 and 0 for an empty
-- log): a file that misses some is refused (22023).
create function public.operator_log_audit_export(p_board_id uuid, p_last_id bigint,
  p_rows integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schools uuid[];
  v_count integer;
begin
  if not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'no such board' using errcode = '22023';
  end if;
  if p_last_id is null or p_last_id < 0 or p_rows is null or p_rows < 0 then
    raise exception 'last_id and rows from 0' using errcode = '22023';
  end if;
  v_schools := array(select s.id from public.schools s where s.board_id = p_board_id);
  select count(*)::integer into v_count
  from public.audit_log a
  where (a.board_id = p_board_id or a.school_id = any (v_schools)) and a.id <= p_last_id;
  if v_count <> p_rows then
    raise exception 'the export holds % entries, the log % up to that one', p_rows, v_count
      using errcode = '22023';
  end if;
  perform app.log_audit('audit_log.operator_exported', p_board_id, null, 'audit_log', null,
    jsonb_build_object('rows', p_rows, 'last_id', p_last_id), 'service');
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Deleting a board needs a recent export
-- ---------------------------------------------------------------------------------------

-- As in 20261201090100_pilot_accounts.sql, with the export check first (LXB01) and the count of
-- entries written since the export.
create or replace function public.operator_delete_board(p_board_id uuid, p_confirm_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_schools uuid[];
  v_users uuid[];
  v_items integer;
  v_classes integer;
  v_people integer;
  v_audit integer;
  v_export_at timestamptz;
  v_export_last bigint;
  v_since integer;
begin
  select * into v_board from public.boards b where b.id = p_board_id for update;
  if v_board.id is null or p_confirm_slug is distinct from v_board.slug then
    raise exception 'type the board''s slug to confirm' using errcode = '22023';
  end if;
  select a.occurred_at, (a.details ->> 'last_id')::bigint into v_export_at, v_export_last
  from public.audit_log a
  where a.board_id = p_board_id and a.action = 'audit_log.operator_exported'
  order by a.id desc
  limit 1;
  if v_export_at is null or v_export_at < now() - interval '7 days' then
    raise exception 'export the board''s whole audit log first (pnpm admin export-audit), at most 7 days before'
      using errcode = 'LXB01';
  end if;
  v_schools := array(select s.id from public.schools s where s.board_id = p_board_id);
  select count(*)::integer into v_since
  from public.audit_log a
  where (a.board_id = p_board_id or a.school_id = any (v_schools))
    and a.id > v_export_last and a.action <> 'audit_log.operator_exported';
  v_users := array(
    select m.user_id
    from (
      select ur.user_id from public.user_roles ur where ur.board_id = p_board_id
      union
      select ct.user_id from public.class_teachers ct
      join public.classes c on c.id = ct.class_id
      where c.school_id = any (v_schools)
      union
      select a.teacher_id from public.absences a where a.school_id = any (v_schools)
    ) m
    where app.staff_board_ids(m.user_id) <@ array[p_board_id]
    order by m.user_id);

  -- Resources and classes first: their subjects and school years go with the board, and those
  -- references are `restrict`.
  delete from public.library_items i where i.board_id = p_board_id;
  get diagnostics v_items = row_count;
  delete from public.classes c where c.school_id = any (v_schools);
  get diagnostics v_classes = row_count;
  delete from public.boards b where b.id = p_board_id;
  delete from public.users u where u.id = any (v_users);
  get diagnostics v_people = row_count;

  perform set_config('app.audit_retention_purge', 'on', true);
  delete from public.audit_log a where a.board_id = p_board_id or a.school_id = any (v_schools);
  get diagnostics v_audit = row_count;
  perform set_config('app.audit_retention_purge', 'off', true);

  return jsonb_build_object('userIds', to_jsonb(v_users), 'schools', cardinality(v_schools),
    'classes', v_classes, 'libraryItems', v_items, 'people', v_people, 'auditRows', v_audit,
    'auditRowsSinceExport', v_since);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Permissions: the operator only (admin CLI), never a signed-in user
-- ---------------------------------------------------------------------------------------

revoke execute on function
  public.operator_export_audit(uuid, bigint, integer),
  public.operator_log_audit_export(uuid, bigint, integer)
from public, anon, authenticated;
grant execute on function
  public.operator_export_audit(uuid, bigint, integer),
  public.operator_log_audit_export(uuid, bigint, integer)
to service_role;
