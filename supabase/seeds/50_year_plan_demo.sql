-- « Mon année » demo (DECISIONS D-123, D-124). Written by hand; loaded after the curriculum
-- sample (10_curriculum_demo.sql has the 3e Mathématiques B2 attentes) and the demo planning
-- (seed.sql), by config.toml `sql_paths` and tools/lite-stack/stack.sh `cmd_seed`:
--   - the board's report periods for 2026-2027, the « dates habituelles » that
--     `typicalReportPeriods` proposes (a unit test in packages/domain pins them; the remise of
--     the first term moves from Monday 15 February, « Jour de la Famille », to Friday the 12th);
--   - a planned window on each of the four seeded units, around the current week while the
--     seeded year has at least six weeks to go, otherwise fixed dates in the fall of 2026 (so a
--     reset never fails after June 2027);
--   - the attentes each unit aims at (found by subject, grade and code; a missing one raises);
--   - one planned 3e Mathématiques unit with no lessons, placed after the current one.

do $$
declare
  v_year constant uuid := 'a0000000-0000-4000-8000-000000000001';      -- 2026-2027
  v_class3 constant uuid := 'e0000000-0000-4000-8000-000000000003';    -- 3e année
  v_fra3 constant uuid := '30000000-0000-4000-8000-000000000301';
  v_mat3 constant uuid := '30000000-0000-4000-8000-000000000302';
  v_mat5 constant uuid := '30000000-0000-4000-8000-000000000501';
  v_sci5 constant uuid := '30000000-0000-4000-8000-000000000502';
  v_starts date;
  v_ends date;
  v_mon date := date_trunc('week', current_date)::date;   -- this week's Monday
  v_relative boolean;
  v_planned uuid;
  v_count integer;
  r record;
begin
  select y.starts_on, y.ends_on into v_starts, v_ends from public.school_years y where y.id = v_year;
  if v_starts is null then
    raise exception 'year plan demo: school year % not found (load seed.sql first)', v_year;
  end if;

  -- Report periods (« Préremplir avec les dates habituelles »).
  insert into public.report_periods (school_year_id, kind, starts_on, ends_on, due_on, issued_on)
  values
    (v_year, 'progress', '2026-09-02', '2026-10-30', '2026-11-06', '2026-11-13'),
    (v_year, 'term1', '2026-09-02', '2027-01-29', '2027-02-05', '2027-02-12'),
    (v_year, 'term2', '2027-02-01', '2027-06-11', '2027-06-16', '2027-06-25');

  -- The planned 3e Mathématiques unit, after « Les nombres jusqu'à 1 000 ».
  insert into public.units (class_id, subject_id, title, description, status, sort_order)
  values (v_class3, (select id from public.subjects where code = 'mat' and board_id is null),
    'L''addition et la soustraction jusqu''à 1 000',
    'Stratégies de calcul mental et résolution de problèmes.', 'planned', 2)
  returning id into v_planned;

  -- Windows: a few weeks around today while the year is on, else the fall of 2026.
  v_relative := current_date between v_starts and v_ends - 42;
  for r in
    select * from (values
      (v_fra3, -14, 25, '2026-09-08'::date, '2026-10-16'::date),
      (v_mat3, -14, 11, '2026-09-08', '2026-10-02'),
      (v_mat5, -21, 18, '2026-09-08', '2026-10-23'),
      (v_sci5, -7, 32, '2026-09-14', '2026-10-30'),
      (v_planned, 14, 39, '2026-10-05', '2026-11-06')
    ) as w (unit_id, from_mon, to_mon, fixed_start, fixed_end)
  loop
    update public.units
    set planned_start_on = case when v_relative then greatest(v_starts, v_mon + r.from_mon)
          else r.fixed_start end,
        planned_end_on = case when v_relative then least(v_ends, v_mon + r.to_mon)
          else r.fixed_end end
    where id = r.unit_id;
  end loop;

  -- The attentes each unit aims at.
  for r in
    select * from (values
      (v_fra3, 'fra', '3', array['C1.1', 'C1.2', 'C1.3', 'D1.1']),
      (v_mat3, 'mat', '3', array['B1.1', 'B1.2', 'B1.3']),
      (v_mat5, 'mat', '5', array['B1.5', 'B1.6', 'B1.7']),
      (v_sci5, 'sci', '5', array['D2.1', 'D2.2']),
      (v_planned, 'mat', '3', array['B2.3', 'B2.5'])
    ) as a (unit_id, subject_code, grade_code, codes)
  loop
    insert into public.unit_expectations (unit_id, expectation_id)
    select r.unit_id, e.id
    from public.curriculum_expectations e
    join public.subjects s on s.id = e.subject_id and s.code = r.subject_code and s.board_id is null
    where e.grade_code = r.grade_code and e.code = any (r.codes);
    get diagnostics v_count = row_count;
    if v_count <> cardinality(r.codes) then
      raise exception 'year plan demo: % of the attentes % (% %e année) found',
        v_count, r.codes, r.subject_code, r.grade_code;
    end if;
  end loop;
end;
$$;

-- The seed's own events are just noise for the worker.
delete from public.event_outbox;
