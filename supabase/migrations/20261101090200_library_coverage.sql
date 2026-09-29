-- Phase 5: « Couverture du curriculum » (D-094). For a grade and subject, each attente with the
-- number of the board's approved resources linked to it, so gaps show before anyone plans a unit
-- or a bulk run. The web page (`/library/coverage`) and the operator's `pnpm admin coverage`
-- read the same function.
--
--  1. app.library_coverage_rows: the counting rule, for one grade and subject or for all of a
--     board's (the summary). Internal: the definer functions and the bulk planner (D-097, its
--     « --from-coverage ») call it as their owner.
--  2. app.library_coverage_access: who may read a board's coverage, and who sees « en révision ».
--  3. public.library_coverage: the attentes of a grade and subject.
--  4. public.library_coverage_summary: « Vue d'ensemble », per grade and subject.
--  5. Permissions.
--
-- What counts (D-094): for a specific attente, the board's `board_approved` items linked to it;
-- for an overall attente, the items linked to it or to one of its specific attentes, each once.
-- Browsing (D-069) also matches the parent attente, so its numbers can be higher; the page says
-- so. Approved items are always board-wide (library_items_approved_board), so counting them
-- reveals nothing a staff member of the board could not already read; items that are only
-- shared (with a school or the board) are not counted. « En révision » is for the board's
-- content reviewers and the operator: requested items and the board's own drafts, archived ones
-- left out.
--
-- DECISIONS: D-094.
-- Tests: supabase/tests/23_library_coverage.test.sql

-- ---------------------------------------------------------------------------------------
-- 1. The counting rule
-- ---------------------------------------------------------------------------------------

-- The attentes of a grade and subject (either null: every grade, or every standard and board
-- subject), with the board's approved resources and those in review. The coverage units, which
-- totals count, are the specific attentes plus the overall attentes without children; an overall
-- attente with children is a heading for them. The first twelve columns are the plan's; the
-- later ones were added for the summary and the English interface.
create function app.library_coverage_rows(p_board_id uuid, p_grade_code text, p_subject_id uuid)
returns table (
  expectation_id uuid,
  parent_id uuid,
  strand_id uuid,
  kind public.expectation_kind,
  code text,
  text_fr text,
  is_verified boolean,
  sort_order integer,
  has_children boolean,
  approved_count integer,
  in_review_count integer,
  approved_types text[],
  text_en text,
  grade_code text,
  subject_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with exps as (
    select e.id, e.parent_id, e.strand_id, e.kind, e.code, e.text_fr, e.text_en, e.is_verified,
      e.sort_order, e.grade_code, e.subject_id,
      exists (select 1 from public.curriculum_expectations c where c.parent_id = e.id) as has_children
    from public.curriculum_expectations e
    join public.subjects s on s.id = e.subject_id
    where (p_grade_code is null or e.grade_code = p_grade_code)
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (s.board_id is null or s.board_id = p_board_id)
  ),
  -- Which item links count for each attente: its own; for an overall attente, its specific
  -- attentes' too (a union, so an item linked to both counts once).
  links as (
    select x.id as expectation_id, le.item_id
    from exps x
    join public.library_item_expectations le on le.expectation_id = x.id
    union
    select x.id, le.item_id
    from exps x
    join public.curriculum_expectations c on c.parent_id = x.id
    join public.library_item_expectations le on le.expectation_id = c.id
    where x.kind = 'overall'
  ),
  items as (
    select l.expectation_id, i.id, i.type, i.status, i.board_owned, i.review_requested_at
    from links l
    join public.library_items i on i.id = l.item_id
    where i.board_id = p_board_id and i.status <> 'archived'
  )
  select x.id, x.parent_id, x.strand_id, x.kind, x.code, x.text_fr, x.is_verified, x.sort_order,
    x.has_children,
    (count(distinct it.id) filter (where it.status = 'board_approved'))::integer,
    (count(distinct it.id) filter (where it.status <> 'board_approved'
      and (it.review_requested_at is not null or it.board_owned)))::integer,
    coalesce(array_agg(distinct it.type::text) filter (where it.status = 'board_approved'),
      '{}'::text[]),
    x.text_en, x.grade_code, x.subject_id
  from exps x
  left join items it on it.expectation_id = x.id
  group by x.id, x.parent_id, x.strand_id, x.kind, x.code, x.text_fr, x.text_en, x.is_verified,
    x.sort_order, x.has_children, x.grade_code, x.subject_id;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Who may read a board's coverage
-- ---------------------------------------------------------------------------------------

-- The board's staff (D-094: the page is for everyone with the Library module, which the app
-- checks; the database lets any staff member of the board read it, as every approved item is
-- board-wide), or the operator: the admin CLI runs as the service role, which is the database
-- role PostgREST switches to for the service key (a signed-in user can never take it). Refuses
-- 42501, then 22023 for an unknown board or a subject that is neither standard nor the board's.
-- Returns whether « en révision » may be shown: the operator, or a content reviewer of the board.
create function app.library_coverage_access(p_board_id uuid, p_subject_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  if not v_service and (
    app.active_user_id() is null
    or p_board_id is null
    or not exists (select 1 from app.my_board_ids() b where b = p_board_id)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.subjects s
    where s.id = p_subject_id and (s.board_id is null or s.board_id = p_board_id)
  ) then
    raise exception 'unknown subject' using errcode = '22023';
  end if;
  return v_service or app.am_library_reviewer(p_board_id, 'content');
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. The attentes of a grade and subject
-- ---------------------------------------------------------------------------------------

-- In curriculum order. `in_review_count` is null unless the caller may see it (above).
create function public.library_coverage(p_board_id uuid, p_grade_code text, p_subject_id uuid)
returns table (
  expectation_id uuid,
  parent_id uuid,
  strand_id uuid,
  kind public.expectation_kind,
  code text,
  text_fr text,
  text_en text,
  is_verified boolean,
  sort_order integer,
  has_children boolean,
  approved_count integer,
  in_review_count integer,
  approved_types text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_reviews boolean;
begin
  v_reviews := app.library_coverage_access(p_board_id, p_subject_id);
  if p_grade_code is null or p_subject_id is null then
    raise exception 'grade and subject required' using errcode = '22023';
  end if;
  return query
    select r.expectation_id, r.parent_id, r.strand_id, r.kind, r.code, r.text_fr, r.text_en,
      r.is_verified, r.sort_order, r.has_children, r.approved_count,
      case when v_reviews then r.in_review_count end,
      r.approved_types
    from app.library_coverage_rows(p_board_id, p_grade_code, p_subject_id) r
    order by r.sort_order, r.code, r.expectation_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. « Vue d'ensemble »: per grade and subject
-- ---------------------------------------------------------------------------------------

-- For each grade and active subject (standard or the board's) that has attentes: the coverage
-- units, and how many have no approved resource, fewer than `p_min_approved` (1 to 5), or at
-- least that many. In grade order, then the subjects' order.
create function public.library_coverage_summary(p_board_id uuid, p_min_approved integer default 2)
returns table (
  grade_code text,
  subject_id uuid,
  unit_count integer,
  none_count integer,
  few_count integer,
  covered_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.library_coverage_access(p_board_id, null);
  if p_min_approved is null or p_min_approved not between 1 and 5 then
    raise exception 'threshold from 1 to 5' using errcode = '22023';
  end if;
  return query
    select r.grade_code, r.subject_id,
      count(*)::integer,
      (count(*) filter (where r.approved_count = 0))::integer,
      (count(*) filter (where r.approved_count > 0 and r.approved_count < p_min_approved))::integer,
      (count(*) filter (where r.approved_count >= p_min_approved))::integer
    from app.library_coverage_rows(p_board_id, null, null) r
    join public.grades g on g.code = r.grade_code
    join public.subjects s on s.id = r.subject_id
    where s.active and (r.kind = 'specific' or not r.has_children)
    group by r.grade_code, r.subject_id, g.ordinal, s.sort_order, s.label_fr
    order by g.ordinal, s.sort_order, s.label_fr;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else. The counting rule and the access
--    check stay internal (the definer functions call them as their owner).
-- ---------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;

grant execute on function
  public.library_coverage(uuid, text, uuid),
  public.library_coverage_summary(uuid, integer)
to authenticated, service_role;
