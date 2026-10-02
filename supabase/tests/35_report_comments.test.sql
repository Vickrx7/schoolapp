-- « Commentaires de bulletin », slice S1: the comment bank as library type 26 (`report_comments`):
-- its place in the enum and the « Évaluer » bucket, saving and readiness without duration or
-- materials, the subject a learning-skills bank does without, the faith review of a religion bank,
-- never in a lesson (LXK01), class mode, a substitute plan or on the projector, search, and the
-- library AI requests that refuse it (supabase/migrations/20270118090000_report_comments_type.sql
-- and 20270118090100_report_comments.sql; DECISIONS D-129, D-131).
begin;
\ir _helpers.psql
select plan(35);
select tests.build_fixture();
select tests.build_library_fixture();
-- The operator's role reads the test ids (the content pack export, section 7).
grant usage on schema tests to service_role;
grant select on tests.ids to service_role;

-- A bank's base version: `p_scope` and `p_period`, one entry (a skill for learning skills).
create function tests.bank_content(p_scope text default 'subject', p_period text default 'term')
returns jsonb
language sql
as $$
  select jsonb_build_object('title', '', 'objective', '', 'teacherNote', '',
    'scope', p_scope, 'period', p_period,
    'entries', jsonb_build_array(jsonb_build_object(
      'kind', 'strength',
      'skill', case when p_scope = 'learning_skills' then 'collaboration' end,
      'level', case when p_period <> 'progress' and p_scope <> 'learning_skills' then 3 end,
      'progress', null, 'rating', null, 'category', null,
      'expectationCodes', '[]'::jsonb,
      'neutral', '{prénom} partage ses idées et écoute celles des autres.',
      'feminine', '', 'masculine', '')));
$$;

-- A save_library_item payload for a bank of board A: 3e année, the subject of `p_subject_code`
-- (none when null), no attente, no duration or materials, a keyword.
create function tests.bank_payload(
  p_title text,
  p_scope text default 'subject',
  p_subject_code text default 'mat',
  p_changes jsonb default '{}'
)
returns jsonb
language sql
as $$
  select (tests.library_payload('report_comments', p_title)
    || jsonb_build_object(
      'subjectId', (select id from public.subjects where code = p_subject_code and board_id is null),
      'durationMinutes', null, 'materials', '', 'keywords', 'bulletin commentaires',
      'expectationIds', '[]'::jsonb, 'tagIds', '[]'::jsonb,
      'versions', jsonb_build_array(jsonb_build_object('languageLevelId', null,
        'content', tests.bank_content(p_scope), 'answerKey', null))))
    || p_changes;
$$;

-- ---------------------------------------------------------------------------------------
-- 1. The type, its bucket and its flags
-- ---------------------------------------------------------------------------------------

select is(
  (select array_agg(t::text order by n) from unnest(enum_range(null::public.library_item_type))
     with ordinality e (t, n)
   where n between array_position(enum_range(null::public.library_item_type), 'rubric')
     and array_position(enum_range(null::public.library_item_type), 'rubric') + 2),
  array['rubric', 'report_comments', 'game'],
  'report_comments comes right after rubric in library_item_type'
);
select is(app.library_bucket_for('report_comments'), 'evaluer'::public.library_bucket,
  'a comment bank is in « Évaluer »');
select ok(
  not app.library_type_levelable('report_comments')
    and app.library_type_never_sub_friendly('report_comments'),
  'it has no versions per level and is never for a substitute'
);
select ok(
  position('{prénom} partage ses idées' in app.library_content_text(tests.bank_content())) > 0
    and app.library_content_text(tests.bank_content() || jsonb_build_object('entries',
      jsonb_build_array(jsonb_build_object('kind', 'strength', 'skill', 'initiative',
        'progress', 'well', 'rating', 'good', 'expectationCodes', jsonb_build_array('B1.2'),
        'neutral', 'Texte')))) !~ 'subject|term|strength|initiative|well|good|B1',
  'search indexes the entries'' texts, not their scope, period, kind, marks or codes'
);

-- ---------------------------------------------------------------------------------------
-- 2. Saving and readiness (D-067 as amended): no duration, materials or attentes
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.save_library_item(tests.remember('bank', gen_random_uuid()), null,
    tests.bank_payload('Commentaires de mathématiques'))$$,
  'a teacher saves a bank without duration, materials or attentes'
);
select tests.clear_authentication();
select results_eq(
  $$select bucket::text, duration_minutes, materials, is_projectable, status::text
    from public.library_items where id = tests.id('bank')$$,
  $$values ('evaluer', null::smallint, null::text, false, 'draft')$$,
  'it is stored in « Évaluer », with no duration or materials'
);

select tests.authenticate_as('teacher_a');
select is(
  split_part(tests.error_of($$select public.save_library_item(gen_random_uuid(), null,
    tests.bank_payload('Pour la suppléance', p_changes => '{"subFriendly": true}'))$$), ' ', 1),
  '23514', 'a bank is never for a substitute'
);
select is(
  split_part(tests.error_of($$select public.save_library_item(gen_random_uuid(), null,
    tests.bank_payload('Au projecteur', p_changes => '{"isProjectable": true}'))$$), ' ', 1),
  '23514', 'nor projectable'
);
select is(
  split_part(tests.error_of($$select public.save_library_item(gen_random_uuid(), null,
    tests.bank_payload('Interactive', p_changes => '{"isInteractive": true}'))$$), ' ', 1),
  '23514', 'nor interactive'
);
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('bank'), true)$$,
  'it is marked reviewed with no duration, materials or attentes'
);

select lives_ok(
  $$select public.save_library_item(tests.remember('skills_bank', gen_random_uuid()), null,
      tests.bank_payload('Habiletés d’apprentissage', 'learning_skills', null));
    select public.library_mark_reviewed(tests.id('skills_bank'), true)$$,
  'a learning-skills bank needs no subject and no attente'
);
select public.save_library_item(tests.remember('no_subject', gen_random_uuid()), null,
  tests.bank_payload('Sans matière', 'subject', null));
select is(
  tests.error_of($$select public.library_mark_reviewed(tests.id('no_subject'), true)$$),
  'LXL01 subject', 'a subject bank needs a subject'
);
select public.save_library_item(tests.remember('no_subject_rel', gen_random_uuid()), null,
  tests.bank_payload('Religion sans matière', 'religion', null));
select is(
  tests.error_of($$select public.library_mark_reviewed(tests.id('no_subject_rel'), true)$$),
  'LXL01 subject', 'so does a religion bank'
);
select public.save_library_item(tests.remember('with_exp', gen_random_uuid()), null,
  tests.bank_payload('Avec attente', 'subject', 'fra',
    jsonb_build_object('expectationIds', jsonb_build_array(tests.id('exp_a')))));
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('with_exp'), true)$$,
  'a bank may also link attentes of its subject and grades'
);
select is(
  tests.error_of($$select public.save_library_item(tests.id('with_exp'),
    (select content_revision from public.library_items where id = tests.id('with_exp')),
    tests.bank_payload('Avec attente', 'subject', 'fra',
      jsonb_build_object('durationMinutes', null, 'expectationIds', '[]'::jsonb)))$$),
  null, 'a reviewed bank stays ready without its attentes'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 3. Enseignement religieux: the faith review (D-064)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.remember('ere_bank', gen_random_uuid()), null,
  tests.bank_payload('Enseignement religieux', 'religion', 'ere'));
select public.library_mark_reviewed(tests.id('ere_bank'), true);
select tests.clear_authentication();
select ok(
  (select requires_faith_review from public.library_items where id = tests.id('ere_bank')),
  'a religion bank needs a faith review'
);
select tests.authenticate_as('teacher_a');
select is(
  tests.error_of($$select public.library_share(tests.id('ere_bank'), 'board')$$),
  'LXL03', 'it reaches the whole board only after its faith review'
);
select lives_ok(
  $$select public.library_share(tests.id('ere_bank'), 'school', tests.id('school_a1'))$$,
  'sharing with the school stays the teacher''s choice'
);

-- ---------------------------------------------------------------------------------------
-- 4. Not teaching material: never in a lesson (LXK01) or on devices
-- ---------------------------------------------------------------------------------------

select is(
  tests.error_of($$insert into public.unit_lessons (unit_id, sequence_number, title, library_item_id)
    values (tests.id('unit_a'), 9, 'Bulletin', tests.id('bank'))$$),
  'LXK01', 'a new lesson never links a bank'
);
select is(
  tests.error_of($$update public.unit_lessons set library_item_id = tests.id('bank')
    where id = tests.id('lesson_a1')$$),
  'LXK01', 'nor does an existing one'
);
select is(
  tests.error_of($$select public.add_library_item_to_unit(tests.id('bank'), tests.id('unit_a'), null,
    '{"title": "Commentaires", "durationMinutes": 30}')$$),
  'LXK01', '« Ajouter à ma planification » refuses it'
);
select lives_ok(
  $$update public.unit_lessons set title = 'Lesson A1 (renommée)' where id = tests.id('lesson_a1')$$,
  'lessons that do not link a bank are unaffected'
);
select is(
  tests.error_of($$select public.start_class_session(tests.id('class_a'), tests.id('bank'), null, 'solo')$$),
  'LXC04', 'class mode refuses it'
);
select tests.clear_authentication();
select is(
  split_part(tests.error_of(
    $$update public.library_items set is_projectable = true where id = tests.id('bank')$$), ' ', 1),
  '23514', 'even the database owner cannot make it projectable'
);

-- ---------------------------------------------------------------------------------------
-- 5. Search (D-068) and sharing (D-065)
-- ---------------------------------------------------------------------------------------

-- An approved board bank (the seed's are approved by the board's reviewer, D-071).
select tests.library_item('board_bank', null, 'report_comments', 'board_approved', 'board');
update public.library_items set duration_minutes = null, materials = null where id = tests.id('board_bank');
update public.library_item_versions set content = tests.bank_content()
where item_id = tests.id('board_bank');
select app.library_refresh_search(tests.id('board_bank'));

select tests.authenticate_as('principal_a2');
select is(
  (select array_agg(x ->> 'id' order by x ->> 'id')
   from jsonb_array_elements(public.search_library(
     '{"types": ["report_comments"], "q": "bulletin"}') -> 'items') x),
  array[tests.id('board_bank')::text],
  '« bulletin » finds the approved bank (other schools'' and private banks stay out)'
);
select is(
  (public.search_library('{"q": "prochaines étapes"}') -> 'items' -> 0 ->> 'id'),
  tests.id('board_bank')::text,
  'what teachers call it finds it too'
);
select is(
  public.search_library('{"types": ["report_comments"]}') #>> '{facets,bucket,evaluer}',
  '1', 'it counts in « Évaluer »'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a');
select is(
  (select count(*)::int from jsonb_array_elements(public.search_library(
     '{"types": ["report_comments"]}') -> 'items') x
   where x ->> 'id' = tests.id('ere_bank')::text),
  1, 'a bank shared with the school reaches its principal like any item'
);
select tests.clear_authentication();

select is(
  (select approved_count from app.library_coverage_rows(tests.id('board_a'), '3',
     (select id from public.subjects where code = 'fra' and board_id is null))
   where expectation_id = tests.id('exp_a')),
  0, 'an approved bank linked to an attente never counts in « Couverture du curriculum »'
);

-- ---------------------------------------------------------------------------------------
-- 6. The library's AI requests refuse it: banks have their own (D-132)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), jsonb_build_object(
    'itemType', 'report_comments', 'gradeCodes', jsonb_build_array('3'),
    'subjectId', (select id from public.subjects where code = 'mat' and board_id is null),
    'expectationIds', '[]'::jsonb, 'levelIds', '[]'::jsonb, 'durationMinutes', 30,
    'subFriendly', false, 'teacherNote', ''))$$),
  '22023', '« Créer avec l''IA » refuses a comment bank'
);
select is(
  tests.error_of($$select public.request_library_item(tests.id('school_a1'), jsonb_build_object(
    'itemType', 'report_comments', 'gradeCodes', jsonb_build_array('3'),
    'subjectId', (select id from public.subjects where code = 'mat' and board_id is null),
    'expectationIds', '[]'::jsonb, 'levelIds', '[]'::jsonb, 'durationMinutes', 30,
    'subFriendly', false, 'teacherNote', ''))$$),
  '22023', 'and never queues one'
);
select is(
  tests.error_of($$select public.library_levels_ai_preview(tests.id('bank'), tests.id('school_a1'),
    array[tests.board_level('board_a', 'debutant')])$$),
  '22023', 'a bank has no versions per level to write'
);
select tests.clear_authentication();
select is(
  tests.error_of($$select app.library_item_ai_input_for_board(tests.id('board_a'), null,
    jsonb_build_object('itemType', 'report_comments', 'gradeCodes', jsonb_build_array('3'),
      'subjectId', (select id from public.subjects where code = 'mat' and board_id is null),
      'durationMinutes', 30))$$),
  '22023', 'nor does bulk generation build one (the board''s input)'
);

-- ---------------------------------------------------------------------------------------
-- 7. Content packs (D-100): a learning-skills bank travels without a subject
-- ---------------------------------------------------------------------------------------

-- An approved learning-skills bank of the board's own (as the seed's).
select tests.library_item('board_skills', null, 'report_comments', 'board_approved', 'board');
delete from public.library_item_expectations where item_id = tests.id('board_skills');
update public.library_items set subject_id = null, duration_minutes = null, materials = null
where id = tests.id('board_skills');
update public.library_item_versions set content = tests.bank_content('learning_skills')
where item_id = tests.id('board_skills');
select set_config('role', 'service_role', true);
select is(
  (select x -> 'subjectCode' from jsonb_array_elements(public.content_pack_export_items(
     tests.id('board_a'), '{"slug": "test-pack"}', null, 100) -> 'items') x
   where x ->> 'key' = tests.id('board_skills')::text),
  'null'::jsonb,
  'the export keeps a bank without a subject, with subjectCode null'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.content_pack_export_items(
     tests.id('board_a'), '{"slug": "test-pack", "subjectCodes": ["fra"]}', null, 100) -> 'items') x
   where x ->> 'key' = tests.id('board_skills')::text),
  0, 'a subject filter leaves it out'
);
select tests.clear_authentication();

select * from finish();
rollback;
