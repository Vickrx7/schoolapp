-- « Commentaires de bulletin », slice S1: the comment bank as library type 26 (`report_comments`):
-- its place in the enum and the « Évaluer » bucket, saving and readiness without duration or
-- materials, the subject a learning-skills bank does without, the faith review of a religion bank,
-- never in a lesson (LXK01), class mode, a substitute plan or on the projector, search, and the
-- library AI requests that refuse it (supabase/migrations/20270118090000_report_comments_type.sql
-- and 20270118090100_report_comments.sql; DECISIONS D-129, D-131). Slice S2: « Créer une banque
-- avec l'IA », its request built from ids, its refusals and the answer turned into a private draft
-- (20270118090200_report_comments_ai.sql; D-132).
begin;
\ir _helpers.psql
select plan(66);
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

-- ---------------------------------------------------------------------------------------
-- 8. « Créer une banque avec l'IA » (slice S2, D-132;
--    supabase/migrations/20270118090200_report_comments_ai.sql). The worker's part is played by
--    superuser updates of ai_jobs, as apps/worker/src/ai.ts writes them.
-- ---------------------------------------------------------------------------------------

-- A request as the web server sends it: ids and choices only. `p_changes` replaces keys.
create function tests.bank_request(p_changes jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'scope', 'subject',
    'period', 'term',
    'gradeCode', '3',
    'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
    'expectationIds', jsonb_build_array(tests.id('exp_a')),
    'length', 'medium',
    'teacherNote', 'Insister sur la lecture à voix haute.'
  ) || p_changes;
$$;

-- What the worker records when a job finishes: a usage row, then the job (finishJob).
create function tests.finish_bank_job(p_job uuid, p_result jsonb)
returns void
language plpgsql
as $$
declare
  v_gen uuid;
begin
  insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
    provider, model, status)
  select j.board_id, j.school_id, j.user_id, j.feature, 'v1', 'fake', 'fake', 'succeeded'
  from public.ai_jobs j where j.id = p_job
  returning id into v_gen;
  update public.ai_jobs
  set status = 'succeeded', result = p_result, sent_text = 'Banque de commentaires de bulletin…',
      ai_generation_id = v_gen, finished_at = now()
  where id = p_job;
end;
$$;

-- An answer as the AI gives it once normalized: one point fort for E1 at level 3 (with the
-- attente's code from `expectationKey`) and one general comment.
create function tests.bank_answer()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'title', 'Commentaires de bulletin : Français, 3e année',
    'summary', 'Des points forts et des prochaines étapes.',
    'keywords', 'bulletin, lecture',
    'entries', jsonb_build_array(
      jsonb_build_object('kind', 'strength', 'expectationKey', 'E1', 'skill', null, 'level', 3,
        'progress', null, 'rating', null, 'category', 'connaissance',
        'neutral', '{prénom} dégage l’idée principale d’un texte avec une compréhension générale.',
        'feminine', '', 'masculine', '', 'expectationCodes', jsonb_build_array('T1.2')),
      jsonb_build_object('kind', 'general', 'expectationKey', null, 'skill', null, 'level', null,
        'progress', null, 'rating', null, 'category', null,
        'neutral', 'Les progrès de {prénom} en lecture sont réguliers.', 'feminine', '',
        'masculine', '', 'expectationCodes', '[]'::jsonb)));
$$;

select lives_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input) values
      (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'report_comment_bank', '{}')$$,
  'jobs accept the comment bank feature'
);
delete from public.ai_jobs where feature = 'report_comment_bank';

-- The preview: exactly what would be sent, built from the database.
select tests.authenticate_as('teacher_a');
select is(
  public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(jsonb_build_object(
    -- Labels sent by a client are never used.
    'gradeLabels', jsonb_build_array('CE2'), 'subjectLabel', 'Autre chose',
    'expectations', jsonb_build_array(jsonb_build_object('key', 'E1', 'text', 'Inventé'))))),
  jsonb_build_object('itemType', 'report_comments', 'scope', 'subject', 'period', 'term',
    'length', 'medium', 'gradeCodes', jsonb_build_array('3'),
    'gradeLabels', jsonb_build_array('3e année'),
    'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
    'subjectLabel', 'Français',
    'expectations', jsonb_build_array(jsonb_build_object('key', 'E1',
      'expectationId', tests.id('exp_a'), 'code', 'T1.2',
      'text', 'Dégager l''idée principale d''un texte informatif.', 'kind', 'specific',
      'strandLabel', null)),
    'teacherNote', 'Insister sur la lecture à voix haute.'),
  'the preview has the labels, the attentes with E-keys, codes and texts, and the note: no school, class or student'
);
select results_eq(
  $$select x -> 'subjectId', x -> 'subjectLabel', x -> 'expectations', x -> 'gradeLabels'
    from (select public.report_comment_bank_ai_preview(tests.id('school_a1'),
      tests.bank_request('{"scope": "learning_skills", "subjectId": null, "expectationIds": [],
        "period": "progress", "gradeCode": "5"}')) as x) t$$,
  $$values ('null'::jsonb, 'null'::jsonb, '[]'::jsonb, '["5e année"]'::jsonb)$$,
  'a learning-skills bank has no subject and no attente'
);
select is(
  public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(jsonb_build_object(
    'scope', 'religion', 'expectationIds', '[]'::jsonb,
    'subjectId', (select id from public.subjects where code = 'ere' and board_id is null)))) ->> 'subjectLabel',
  'Enseignement religieux', 'a religion bank is about Enseignement religieux'
);
select is(
  jsonb_array_length(public.report_comment_bank_ai_preview(tests.id('school_a1'),
    tests.bank_request('{"expectationIds": []}')) -> 'expectations'),
  0, 'a subject bank may have no attente (« commentaires généraux »)'
);
select tests.clear_authentication();

-- Twelve more attentes of Français, 3e année.
insert into public.curriculum_expectations (subject_id, grade_code, parent_id, kind, code, text_fr,
  curriculum_version)
select (select id from public.subjects where code = 'fra' and board_id is null), '3',
  tests.id('exp_a_parent'), 'specific', 'T2.' || n, 'Attente ' || n || '.', 'test'
from generate_series(1, 12) n;

-- Refusals: who may ask (42501).
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a2') and module = 'library';
select tests.authenticate_as('faith_reviewer_a');
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a2'), tests.bank_request())$$),
  '42501', 'a school without the Library module cannot ask'
);
select tests.authenticate_as('office_a');
select is(
  tests.error_of($$select public.request_report_comment_bank(tests.id('school_a1'), tests.bank_request())$$),
  '42501', 'office staff cannot ask'
);
select tests.authenticate_as('teacher_b');
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request())$$),
  '42501', 'nor a teacher of another board at this school'
);
select tests.authenticate_as('former_teacher');
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request())$$),
  '42501', 'nor a deactivated account'
);

-- Refusals: requests the app never sends (22023).
select tests.authenticate_as('teacher_a');
select is(
  array[
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request('{"scope": "school"}'))$$),
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request('{"period": "any"}'))$$),
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request('{"length": "long"}'))$$)
  ],
  array['22023', '22023', '22023'], 'a bad scope, report or length is refused'
);
select is(
  array[
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request('{"gradeCode": ["3", "5"]}'))$$),
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request('{"gradeCode": "K1", "scope": "learning_skills", "subjectId": null, "expectationIds": []}'))$$)
  ],
  array['22023', '22023'], 'two grades, or kindergarten, are refused (one grade, 1re to 8e)'
);
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
    jsonb_build_object('expectationIds', jsonb_build_array(tests.id('exp_other')))))$$),
  '22023', 'an attente of another subject or grade is refused'
);
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
    jsonb_build_object('expectationIds', (select jsonb_agg(id order by code) from public.curriculum_expectations
      where code ~ '^T(2\.\d+|1\.2)$' and grade_code = '3'))))$$),
  '22023', '13 attentes are refused'
);
select lives_ok(
  $$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
    jsonb_build_object('expectationIds', (select jsonb_agg(id order by code) from public.curriculum_expectations
      where code ~ '^T2\.\d+$' and grade_code = '3'))))$$,
  '12 are accepted'
);
select is(
  array[
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
      '{"scope": "learning_skills", "expectationIds": []}'))$$),
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
      '{"scope": "religion", "expectationIds": []}'))$$),
    tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
      jsonb_build_object('expectationIds', '[]'::jsonb,
        'subjectId', (select id from public.subjects where code = 'ere' and board_id is null))))$$)
  ],
  array['22023', '22023', '22023'],
  'the subject fits the scope: none for the learning skills, ERE for religion, never ERE for a subject'
);
select is(
  tests.error_of($$select public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request(
    jsonb_build_object('teacherNote', repeat('a', 501))))$$),
  '22023', 'a note over 500 characters is refused'
);

-- Asking: the AI switch, then one job per request.
select tests.clear_authentication();
update public.schools set ai_enabled = false where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select is(
  tests.error_of($$select public.request_report_comment_bank(tests.id('school_a1'), tests.bank_request())$$),
  'LXA01', 'AI off for the school is refused'
);
select tests.clear_authentication();
update public.schools set ai_enabled = true where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select tests.remember('bank_job', public.request_report_comment_bank(tests.id('school_a1'), tests.bank_request()));
select is(
  public.request_report_comment_bank(tests.id('school_a1'), tests.bank_request()),
  tests.id('bank_job'), 'a second tap while the request is open returns it'
);
select is(
  (select input from public.ai_jobs where id = tests.id('bank_job')),
  public.report_comment_bank_ai_preview(tests.id('school_a1'), tests.bank_request()),
  'the job holds exactly what the preview showed'
);
select tests.clear_authentication();

-- The answer becomes the teacher's private draft.
select tests.finish_bank_job(tests.id('bank_job'), tests.bank_answer());
select tests.remember('ai_bank', (select (result ->> 'itemId')::uuid from public.ai_jobs where id = tests.id('bank_job')));
select results_eq(
  $$select j.status::text, i.type::text, i.author_id, i.status::text, i.share_scope::text,
      i.source::text, i.prompt_version, i.bucket::text, i.school_id
    from public.ai_jobs j join public.library_items i on i.id = (j.result ->> 'itemId')::uuid
    where j.id = tests.id('bank_job')$$,
  $$values ('succeeded', 'report_comments', tests.id('teacher_a'), 'draft', 'private',
      'ai_generated', 'v1', 'evaluer', tests.id('school_a1'))$$,
  'the job succeeded with a private AI draft bank by the teacher, in « Évaluer », with its prompt version'
);
select results_eq(
  $$select subject_id, duration_minutes, materials, is_printable, is_projectable, is_interactive,
      sub_friendly, faith_content
    from public.library_items where id = tests.id('ai_bank')$$,
  $$values ((select id from public.subjects where code = 'fra' and board_id is null), null::smallint,
      null::text, true, false, false, false, false)$$,
  'its subject, no duration or materials, printable only, never for a substitute'
);
select results_eq(
  $$select (select array_agg(grade_code) from public.library_item_grades where item_id = tests.id('ai_bank')),
      (select array_agg(expectation_id) from public.library_item_expectations where item_id = tests.id('ai_bank'))$$,
  $$values (array['3'], array[tests.id('exp_a')])$$,
  'the grade and the attentes of the request'
);
select is(
  (select content from public.library_item_versions where item_id = tests.id('ai_bank')
     and language_level_id is null),
  jsonb_build_object('title', '', 'objective', '', 'teacherNote', '', 'scope', 'subject',
    'period', 'term', 'entries', jsonb_build_array(
      jsonb_build_object('kind', 'strength', 'skill', null, 'level', 3, 'progress', null,
        'rating', null, 'category', 'connaissance', 'expectationCodes', jsonb_build_array('T1.2'),
        'neutral', '{prénom} dégage l’idée principale d’un texte avec une compréhension générale.',
        'feminine', '', 'masculine', ''),
      jsonb_build_object('kind', 'general', 'skill', null, 'level', null, 'progress', null,
        'rating', null, 'category', null, 'expectationCodes', '[]'::jsonb,
        'neutral', 'Les progrès de {prénom} en lecture sont réguliers.', 'feminine', '',
        'masculine', ''))),
  'one base version: the request''s scope and report and the entries, with the library''s keys only'
);
select is(
  (select count(*)::int from public.audit_log where action = 'library_item.generated'
     and entity_id = tests.id('ai_bank')
     and details = jsonb_build_object('ai_job_id', tests.id('bank_job'), 'author_id', tests.id('teacher_a'))),
  1, 'generating is audited with the job and the author only'
);
select tests.authenticate_as('teacher_a');
select is(
  (select count(*)::int from public.library_items where id = tests.id('ai_bank')), 1,
  'the author reads her draft'
);
select tests.authenticate_as('teacher_a_other');
select is(
  (select count(*)::int from public.library_items where id = tests.id('ai_bank')), 0,
  'a colleague does not'
);

-- A learning-skills bank has no subject; a religion bank needs the faith review.
select tests.authenticate_as('teacher_a');
select tests.remember('skills_job', public.request_report_comment_bank(tests.id('school_a1'),
  tests.bank_request('{"scope": "learning_skills", "subjectId": null, "expectationIds": []}')));
select tests.remember('ere_job', public.request_report_comment_bank(tests.id('school_a1'),
  tests.bank_request(jsonb_build_object('scope', 'religion', 'expectationIds', '[]'::jsonb,
    'subjectId', (select id from public.subjects where code = 'ere' and board_id is null)))));
select tests.clear_authentication();
select tests.finish_bank_job(tests.id('skills_job'), tests.bank_answer());
select tests.finish_bank_job(tests.id('ere_job'), tests.bank_answer());
select results_eq(
  $$select i.subject_id is null, i.requires_faith_review, i.faith_content,
      (select count(*)::int from public.library_item_expectations e where e.item_id = i.id)
    from public.ai_jobs j join public.library_items i on i.id = (j.result ->> 'itemId')::uuid
    where j.id in (tests.id('skills_job'), tests.id('ere_job')) order by j.id = tests.id('ere_job')$$,
  $$values (true, false, false, 0), (false, true, true, 0)$$,
  'a learning-skills bank has no subject; a religion bank has faith content and needs the faith review'
);

-- An answer that cannot be stored fails the job and leaves nothing behind.
select tests.authenticate_as('teacher_a');
select tests.remember('bad_job', public.request_report_comment_bank(tests.id('school_a1'),
  tests.bank_request('{"length": "short"}')));
select tests.clear_authentication();
create temporary table bank_count on commit drop as select count(*) as n from public.library_items;
select tests.finish_bank_job(tests.id('bad_job'), jsonb_build_object('title', 'Banque',
  'entries', 'pas une liste'));
select results_eq(
  $$select status::text, error_code, result is null from public.ai_jobs where id = tests.id('bad_job')$$,
  $$values ('failed', 'invalidOutput', true)$$,
  'a malformed answer turns the job into invalidOutput'
);
select is(
  (select count(*) from public.library_items), (select n from bank_count),
  'and creates no bank'
);

-- Permissions.
select ok(
  has_function_privilege('authenticated', 'public.report_comment_bank_ai_preview(uuid, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.request_report_comment_bank(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.report_comment_bank_ai_preview(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.request_report_comment_bank(uuid, jsonb)', 'execute'),
  'signed-in staff may preview and ask; anonymous visitors may not'
);
select ok(
  has_function_privilege('service_role', 'app.report_comment_bank_ai_input(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'app.report_comment_bank_ai_input(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'app.report_comment_bank_ai_input(uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'app.report_comment_bank_from_job(public.ai_jobs)', 'execute'),
  'the input builder takes a user: the service role only; the trigger''s helper has no grant'
);

select * from finish();
rollback;
