-- Catholic references loaded by the operator: one reference per board, type and title; who may
-- run the import; the dry run, the writes, updates in place, retiring, the references it keeps,
-- its audit line, and what it refuses
-- (supabase/migrations/20270210090000_catholic_references_import.sql; DECISIONS D-146, D-103).
begin;
\ir _helpers.psql
select plan(43);
select tests.build_fixture();
select tests.build_library_fixture();

-- Board A has ref_a (virtue « Le respect », text « Respecter chaque personne. », every grade, no
-- season, no tag, no source note); board B has ref_b (virtue « La paix »).

-- Saves a report in pg_temp, so later assertions can read it (results of functions that write
-- cannot be re-run inside a test's query).
create table pg_temp.ref_reports (name text primary key, report jsonb not null);

-- Runs the import as the CLI does (a fixed SHA-256) and keeps its report.
create function tests.ref_import(p_name text, p_board text, p_refs jsonb, p_apply boolean)
returns jsonb
language sql
as $$
  insert into pg_temp.ref_reports (name, report)
  values (p_name, public.catholic_references_import(tests.id(p_board), p_refs, repeat('ab', 32),
    p_apply))
  returning report;
$$;

create function tests.ref_report(p_name text)
returns jsonb
language sql
as $$
  select report from pg_temp.ref_reports where name = p_name;
$$;

-- One reference as the CLI sends it: every field present, these values unless `p_extra` says.
create function tests.ref(p_type text, p_title text, p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object('type', p_type, 'title', p_title,
    'textFr', 'Texte de ' || p_title || '.', 'textEn', null, 'gradeMin', 'K1', 'gradeMax', '8',
    'liturgicalSeason', null, 'tags', '[]'::jsonb, 'sourceNote', 'Texte du conseil.',
    'active', true) || p_extra;
$$;

-- A report's references in file order: « create virtue Le respect ».
create function tests.ref_outcomes(p_name text)
returns text[]
language sql
as $$
  select array_agg((x ->> 'outcome') || ' ' || (x ->> 'type') || ' ' || (x ->> 'title') order by n)
  from jsonb_array_elements(tests.ref_report(p_name) -> 'references') with ordinality t (x, n);
$$;

-- The import's first file for board A: ref_a as it is, and two new references.
create function tests.ref_prayer(p_extra jsonb default '{}')
returns jsonb
language sql
as $$
  select tests.ref('prayer', 'Prière du matin', '{"textEn": "Morning prayer.", "gradeMin": "K2",
    "gradeMax": "3", "liturgicalSeason": "avent", "tags": ["prière", "matin"]}'::jsonb || p_extra);
$$;

create function tests.ref_file_1()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    tests.ref('virtue', 'Le respect', '{"textFr": "Respecter chaque personne.", "sourceNote": null}'),
    tests.ref_prayer(),
    tests.ref('scripture', 'Les Béatitudes (Mt 5, 1-12)', '{"gradeMin": "1"}'));
$$;

-- The CLI connects as service_role.
grant usage on schema tests to service_role;
grant select on tests.ids to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 1. The operator only
-- ---------------------------------------------------------------------------------------

select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon', 'authenticated']) r (rolname)
    where n.nspname in ('public', 'app') and p.proname like 'catholic\_references\_%'
      and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  'API roles cannot execute the import'
);
select set_eq(
  $$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.proname like 'catholic\_references\_%'
      and has_function_privilege('service_role', p.oid, 'execute')$$,
  $$values ('catholic_references_import(uuid,jsonb,text,boolean)')$$,
  'the operator (service role) runs the import through its one public function'
);

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      jsonb_build_array(tests.ref('virtue', 'La joie')), repeat('ab', 32), true)$$,
  '42501', null, 'a board admin cannot run the import through the API'
);
select tests.clear_authentication();

select set_config('role', 'service_role', true);
select lives_ok(
  $$select public.catholic_references_import(tests.id('board_b'),
      jsonb_build_array(tests.ref('virtue', 'La paix')), repeat('ab', 32), false)$$,
  'the operator (service role) runs it'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. One reference per board, type and title
-- ---------------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.catholic_references (board_id, type, title, text_fr)
    values (tests.id('board_a'), 'virtue', 'Le respect', 'Encore le respect.')$$,
  '23505', null, 'a board cannot have two references with the same type and title'
);
select lives_ok(
  $$insert into public.catholic_references (board_id, type, title, text_fr) values
      (tests.id('board_b'), 'reflection', 'La paix', 'Une réflexion sur la paix.'),
      (tests.id('board_b'), 'virtue', 'Le respect', 'Le respect, au conseil B.'),
      (null, 'virtue', 'Test partagé', 'Un.'),
      (null, 'virtue', 'Test partagé', 'Deux.')$$,
  'the same title may be another type''s, another board''s, or that of several shared references'
);

-- ---------------------------------------------------------------------------------------
-- 3. The dry run (the CLI's default)
-- ---------------------------------------------------------------------------------------

select tests.ref_import('dry', 'board_a', tests.ref_file_1(), false);

select is(
  tests.ref_outcomes('dry'),
  array['unchanged virtue Le respect', 'create prayer Prière du matin',
    'create scripture Les Béatitudes (Mt 5, 1-12)'],
  'the dry run matches each reference by type and title'
);
select is(
  tests.ref_report('dry') - 'references' - 'notInFile',
  '{"dryRun": true, "counts": {"created": 2, "updated": 0, "unchanged": 1, "notInFile": 0}}'::jsonb,
  'the dry run counts what the import would do'
);
select is(
  (select count(*)::integer from public.catholic_references where board_id = tests.id('board_a')),
  1, 'the dry run writes no reference'
);
select is_empty(
  $$select 1 from public.audit_log where action = 'catholic_references.imported'$$,
  'the dry run writes no audit line'
);

-- ---------------------------------------------------------------------------------------
-- 4. The import
-- ---------------------------------------------------------------------------------------

select tests.ref_import('apply', 'board_a', tests.ref_file_1(), true);

select is(tests.ref_outcomes('apply'), tests.ref_outcomes('dry'),
  'the import does what the dry run said');
select is((tests.ref_report('apply') ->> 'dryRun')::boolean, false, 'the report says it applied');
select results_eq(
  $$select type::text, title, text_fr, text_en, grade_min::integer, grade_max::integer,
      liturgical_season::text, tags, source_note, active
    from public.catholic_references where board_id = tests.id('board_a') order by type, title$$,
  $$values
    ('virtue', 'Le respect', 'Respecter chaque personne.', null::text, -1, 8, null::text,
     '{}'::text[], null::text, true),
    ('prayer', 'Prière du matin', 'Texte de Prière du matin.', 'Morning prayer.', 0, 3, 'avent',
     '{prière,matin}'::text[], 'Texte du conseil.', true),
    ('scripture', 'Les Béatitudes (Mt 5, 1-12)', 'Texte de Les Béatitudes (Mt 5, 1-12).', null, 1,
     8, null, '{}'::text[], 'Texte du conseil.', true)$$,
  'the board''s references are written as the file says, grade codes as ordinals'
);
select is(
  (select id from public.catholic_references
   where board_id = tests.id('board_a') and type = 'virtue' and title = 'Le respect'),
  tests.id('ref_a'), 'a reference that was already there keeps its id'
);
select is(
  (select created_by from public.catholic_references
   where board_id = tests.id('board_a') and title = 'Prière du matin'),
  null::uuid, 'a reference the operator imports has no author'
);
select results_eq(
  $$select actor_type::text, actor_user_id, school_id, entity_type, entity_id, details
    from public.audit_log
    where action = 'catholic_references.imported' and board_id = tests.id('board_a')$$,
  $$values ('service', null::uuid, null::uuid, 'board', tests.id('board_a'),
      jsonb_build_object('created', 2, 'updated', 0, 'unchanged', 1, 'file_sha256',
        repeat('ab', 32)))$$,
  'the import is audited for the board, as the operator''s, with its counts and the file''s SHA-256'
);
select is(
  (select count(*)::integer from public.catholic_references where board_id = tests.id('board_b')),
  3, 'another board''s references are untouched'
);
select is(
  (select count(*)::integer from public.catholic_references
   where board_id is null and title = 'Test partagé'),
  2, 'shared references are untouched'
);

-- Importing the same file again changes nothing and writes no audit line.
select tests.ref_import('again', 'board_a', tests.ref_file_1(), true);
select is(
  tests.ref_report('again') -> 'counts',
  '{"created": 0, "updated": 0, "unchanged": 3, "notInFile": 0}'::jsonb,
  'importing the same file again finds every reference unchanged'
);
select is(
  (select count(*)::integer from public.audit_log where action = 'catholic_references.imported'),
  1, 'an import that writes nothing is not audited'
);

-- ---------------------------------------------------------------------------------------
-- 5. A later file: updates in place, retiring, the references it does not name
-- ---------------------------------------------------------------------------------------

select tests.ref_import('later', 'board_a', jsonb_build_array(
  tests.ref('virtue', 'Le respect', '{"textFr": "Respecter chaque personne, en paroles et en gestes.",
    "sourceNote": null, "tags": ["respect"]}'),
  tests.ref_prayer('{"active": false}'),
  tests.ref('reflection', 'Dire merci', '{"liturgicalSeason": "temps_ordinaire"}')), true);

select is(
  tests.ref_outcomes('later'),
  array['update virtue Le respect', 'update prayer Prière du matin', 'create reflection Dire merci'],
  'a later file updates the references it changes and creates the new ones'
);
select is(
  jsonb_build_array(tests.ref_report('later') #> '{references,0,changes}',
    tests.ref_report('later') #> '{references,1,changes}'),
  '[["textFr", "tags"], ["active"]]'::jsonb,
  'each update names the fields it changes'
);
select is(
  tests.ref_report('later') -> 'notInFile',
  '[{"type": "scripture", "title": "Les Béatitudes (Mt 5, 1-12)", "active": true}]'::jsonb,
  'the board''s references the file does not name are listed'
);
select results_eq(
  $$select id, text_fr, tags, active from public.catholic_references
    where board_id = tests.id('board_a') and type in ('virtue', 'prayer') order by type$$,
  $$values
    (tests.id('ref_a'), 'Respecter chaque personne, en paroles et en gestes.', '{respect}'::text[],
     true),
    ((select id from public.catholic_references
      where board_id = tests.id('board_a') and title = 'Prière du matin'),
     'Texte de Prière du matin.', '{prière,matin}'::text[], false)$$,
  'updates are made in place; "active": false retires a reference without deleting it'
);
select ok(
  exists (select 1 from public.catholic_references
          where board_id = tests.id('board_a') and type = 'scripture' and active),
  'a reference the file does not name is kept as it is'
);
select is(
  (select details - 'file_sha256' from public.audit_log
   where action = 'catholic_references.imported' and board_id = tests.id('board_a')
   order by id desc limit 1),
  '{"created": 1, "updated": 2, "unchanged": 0}'::jsonb,
  'each import that writes has its own audit line'
);

-- ---------------------------------------------------------------------------------------
-- 6. What the import refuses (the CLI never sends it; nothing is written)
-- ---------------------------------------------------------------------------------------

select throws_ok(
  $$select public.catholic_references_import(gen_random_uuid(),
      jsonb_build_array(tests.ref('virtue', 'La joie')), repeat('ab', 32), false)$$,
  '22023', null, 'an unknown board is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), '[]', repeat('ab', 32), true)$$,
  '22023', null, 'an empty list is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      (select jsonb_agg(tests.ref('virtue', 'Vertu ' || i)) from generate_series(1, 501) i),
      repeat('ab', 32), true)$$,
  '22023', null, 'more than 500 references are refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      jsonb_build_array(tests.ref('virtue', 'La joie')), 'abc', true)$$,
  '22023', null, 'a SHA-256 that is not one is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie'), tests.ref('virtue', 'La joie', '{"textFr": "Autre."}')),
      repeat('ab', 32), true)$$,
  '22023', null, 'the same type and title twice in one file are refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      jsonb_build_array(tests.ref('miracle', 'Les noces de Cana')), repeat('ab', 32), true)$$,
  '22023', null, 'an unknown type is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      jsonb_build_array(tests.ref('virtue', 'La joie', '{"gradeMax": "9"}')), repeat('ab', 32), true)$$,
  '22023', null, 'an unknown grade code is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', '{"gradeMin": "5", "gradeMax": "2"}')), repeat('ab', 32), true)$$,
  '22023', null, 'a grade range that ends before it starts is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', '{"liturgicalSeason": "ete"}')), repeat('ab', 32), true)$$,
  '22023', null, 'an unknown liturgical season is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'),
      jsonb_build_array(tests.ref('virtue', 'La joie') - 'textEn'), repeat('ab', 32), true)$$,
  '22023', null, 'a missing field is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', '{"tags": ["joie", 3]}')), repeat('ab', 32), true)$$,
  '22023', null, 'a tag that is not text is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', jsonb_build_object('tags',
        (select jsonb_agg('mot' || i) from generate_series(1, 13) i)))), repeat('ab', 32), true)$$,
  '22023', null, 'more than 12 tags are refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', '{"active": "oui"}')), repeat('ab', 32), true)$$,
  '22023', null, 'a state that is not true or false is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La joie', jsonb_build_object('textFr', repeat('a', 4001)))),
      repeat('ab', 32), true)$$,
  '23514', null, 'a text longer than the table allows is refused'
);
select throws_ok(
  $$select public.catholic_references_import(tests.id('board_a'), jsonb_build_array(
      tests.ref('virtue', 'La douceur'), tests.ref('virtue', '')), repeat('ab', 32), true)$$,
  '23514', null, 'an empty title is refused'
);
select is_empty(
  $$select 1 from public.catholic_references where title in ('La joie', 'La douceur')$$,
  'a refused file writes nothing, not even its valid references'
);

-- ---------------------------------------------------------------------------------------
-- 7. The audit catalogue (D-103)
-- ---------------------------------------------------------------------------------------

select is(
  (select category || ' ' || audience from public.audit_action_catalog
   where action = 'catholic_references.imported'),
  'library board', 'the board''s admins read the import in their audit log, with the library'
);

select * from finish();
rollback;
