-- Phase 4 library core: resources in planning, usage counts, levels in use, Phase 2 saved texts
-- and substitute plans to rebuild (supabase/migrations/20261015090000_library_core.sql;
-- DECISIONS D-063, D-073, D-076, D-077).
begin;
\ir _helpers.psql
select plan(31);
select tests.build_fixture();
select tests.build_library_fixture();

select tests.library_item('plan_item', 'teacher_a', 'lesson_plan', 'teacher_reviewed');
select tests.library_item('other_private', 'teacher_a_other', 'lesson_plan');
select tests.library_item('pending', 'teacher_a_other', 'worksheet', 'teacher_reviewed');
select tests.library_request('pending');
select tests.library_item('shared', 'teacher_a_other', 'worksheet', 'teacher_reviewed', 'school', 'school_a1');

-- ---------------------------------------------------------------------------------------
-- 1. A lesson plan as a new lesson (add_library_item_to_unit)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('new_lesson', public.add_library_item_to_unit(tests.id('plan_item'),
    tests.id('unit_a'), 2, '{"title": "  Trouver l’idée principale  ", "objectives": "Dégager l’idée principale.",
    "materials": "Texte du huard", "content": "Avant : ...", "subNotes": "Lire à voix haute.",
    "durationMinutes": 45}'))$$,
  'a teacher adds a lesson plan to her unit as lesson 2'
);
select lives_ok(
  $$set constraints public.unit_lessons_sequence_key immediate$$,
  'lesson numbers stay unique'
);
select results_eq(
  $$select title, sequence_number from public.unit_lessons where unit_id = tests.id('unit_a')
    order by sequence_number$$,
  $$values ('Lesson A1', 1), ('Trouver l’idée principale', 2), ('Lesson A2', 3), ('Lesson A3', 4)$$,
  'the lessons after it move down by one'
);
select results_eq(
  $$select library_item_id, objectives, materials, sub_notes, duration_minutes::int
    from public.unit_lessons where id = tests.id('new_lesson')$$,
  $$values (tests.id('plan_item'), 'Dégager l’idée principale.', 'Texte du huard', 'Lire à voix haute.', 45)$$,
  'the new lesson copies the outline and keeps the link to the resource'
);
select results_eq(
  $$select expectation_id from public.unit_lesson_expectations where lesson_id = tests.id('new_lesson')$$,
  $$values (tests.id('exp_a'))$$,
  'the new lesson gets the resource''s attentes'
);
select tests.remember('end_lesson', public.add_library_item_to_unit(tests.id('plan_item'),
  tests.id('unit_a'), null, '{"title": "Encore"}'));
select results_eq(
  $$select sequence_number from public.unit_lessons where id = tests.id('end_lesson')$$,
  $$values (5)$$,
  'without a position, the lesson goes at the end of the unit'
);
select throws_ok(
  $$select public.add_library_item_to_unit(tests.id('plan_item'), tests.id('unit_b'), null, '{"title": "X"}')$$,
  'P0002', null, 'another class''s unit is not found'
);
select throws_ok(
  $$select public.add_library_item_to_unit(tests.id('other_private'), tests.id('unit_a'), null, '{"title": "X"}')$$,
  '42501', null, 'a colleague''s private draft cannot be added'
);
select throws_ok(
  $$select public.add_library_item_to_unit(tests.id('plan_item'), tests.id('unit_a'), null, '{"title": " "}')$$,
  '22023', null, 'the new lesson needs a title'
);
select tests.clear_authentication();
select is((select usage_count from public.library_items where id = tests.id('plan_item')), 1,
  'two lessons of the same unit count as one use');

-- ---------------------------------------------------------------------------------------
-- 2. Attaching to an existing lesson, and usage counts (D-076)
-- ---------------------------------------------------------------------------------------

insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('subject_teacher'));
select tests.authenticate_as('subject_teacher');
select is((select count(*)::int from public.library_items where id = tests.id('pending')), 1,
  'a content reviewer who teaches can read a colleague''s proposed item');
select throws_ok(
  $$update public.unit_lessons set library_item_id = tests.id('pending') where id = tests.id('lesson_a1')$$,
  '42501', null, 'but cannot put it into a lesson before it is shared'
);
select tests.clear_authentication();

insert into public.units (id, class_id, subject_id, title, status) values
  (tests.remember('unit_a2', gen_random_uuid()), tests.id('class_a'),
   (select id from public.subjects where code = 'mat' and board_id is null), 'Unit A2', 'planned');
insert into public.unit_lessons (id, unit_id, sequence_number, title) values
  (tests.remember('lesson_a2_1', gen_random_uuid()), tests.id('unit_a2'), 1, 'Lesson A2-1');

select tests.authenticate_as('teacher_a');
select results_eq(
  $$update public.unit_lessons set library_item_id = tests.id('shared') where id = tests.id('lesson_a1')
    returning id$$,
  $$values (tests.id('lesson_a1'))$$,
  'a teacher attaches an item shared with her school to a lesson'
);
update public.unit_lessons set library_item_id = tests.id('shared') where id = tests.id('lesson_a2');
select tests.clear_authentication();
select is((select usage_count from public.library_items where id = tests.id('shared')), 1,
  'two lessons of one unit are one use');
select tests.authenticate_as('teacher_a');
update public.unit_lessons set library_item_id = tests.id('shared') where id = tests.id('lesson_a2_1');
select tests.clear_authentication();
select is((select usage_count from public.library_items where id = tests.id('shared')), 2,
  'a second unit is a second use');
select tests.authenticate_as('teacher_a');
update public.unit_lessons set library_item_id = null where id = tests.id('lesson_a2_1');
update public.unit_lessons set library_item_id = tests.id('shared') where id = tests.id('lesson_a2_1');
update public.unit_lessons set library_item_id = null where id = tests.id('lesson_a2_1');
update public.unit_lessons set library_item_id = null where id = tests.id('lesson_a2');
update public.unit_lessons set library_item_id = tests.id('shared') where id = tests.id('lesson_a2');
select tests.clear_authentication();
select is((select usage_count from public.library_items where id = tests.id('shared')), 1,
  'adding and removing links again never inflates the count');
select tests.authenticate_as('teacher_a');
delete from public.unit_lessons where id in (tests.id('lesson_a1'), tests.id('lesson_a2'));
select tests.clear_authentication();
select is((select usage_count from public.library_items where id = tests.id('shared')), 0,
  'deleting the lessons brings the count back to zero');

-- ---------------------------------------------------------------------------------------
-- 3. Language levels in use (amends D-046)
-- ---------------------------------------------------------------------------------------

select throws_ok(
  $$delete from public.language_levels where id = tests.board_level('board_a', 'debutant')$$,
  '23503', null, 'a board level that a version uses cannot be deleted'
);
select tests.library_item('b_item', 'teacher_b', 'reading_passage', 'draft', 'private', null, 'board_b');
select lives_ok(
  $$delete from public.boards where id = tests.id('board_b')$$,
  'deleting a board still removes its levels, with the versions that use them'
);

-- ---------------------------------------------------------------------------------------
-- 4. Phase 2 saved texts (D-073)
-- ---------------------------------------------------------------------------------------

with r as (
  insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
    provider, model, status)
  values (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'differentiate', 'v1',
    'fake', 'fake', 'succeeded')
  returning id
)
select tests.remember('gen', id) from r;
insert into public.ai_jobs (id, board_id, school_id, user_id, feature, input, status, result,
  ai_generation_id, finished_at) values
  (tests.remember('job', gen_random_uuid()), tests.id('board_a'), tests.id('school_a1'),
   tests.id('teacher_a'), 'differentiate', '{}', 'succeeded', '{"versions": []}', tests.id('gen'), now()),
  (tests.remember('sub_job', gen_random_uuid()), tests.id('board_a'), tests.id('school_a1'),
   tests.id('teacher_a'), 'sub_plan', '{}', 'succeeded', '{}', tests.id('gen'), now());

select tests.authenticate_as('teacher_a');
select lives_ok(
  format($$select tests.remember('saved', public.save_ai_job_to_library(tests.id('job'),
    'reading_passage', 'Le castor', %L::jsonb, '3'))$$,
    jsonb_build_array(
      jsonb_build_object('language_level_id', null, 'content', jsonb_build_object('title', 'Le castor',
        'objective', 'Lire', 'teacherNote', '', 'text', 'Le castor construit des barrages.',
        'glossary', '[]'::jsonb, 'visualSupports', '[]'::jsonb, 'questions', '[]'::jsonb)),
      jsonb_build_object('language_level_id', tests.board_level('board_a', 'debutant'),
        'content', jsonb_build_object('title', 'Le castor', 'objective', 'Lire', 'teacherNote', '',
          'text', 'Le castor fait des barrages.', 'glossary', '[]'::jsonb,
          'visualSupports', '[]'::jsonb, 'questions', jsonb_build_array(jsonb_build_object(
            'id', 'q1', 'kind', 'short_answer', 'prompt', 'Que fait le castor?', 'hint', '',
            'points', null, 'category', null, 'lines', 3))),
        'answer_key', jsonb_build_object('solution', '', 'answers', jsonb_build_array(
          jsonb_build_object('questionId', 'q1', 'kind', 'short_answer', 'sampleAnswer', '',
            'acceptableAnswers', '[]'::jsonb, 'explanation', '')))))),
  'a « Texte différencié » result is saved with its answer keys'
);
select results_eq(
  $$select (select array_agg(distinct v.schema_version) from public.library_item_versions v
            where v.item_id = i.id),
      (select count(*)::int from public.library_item_answer_keys k
       join public.library_item_versions v on v.id = k.version_id where v.item_id = i.id),
      i.search_document @@ to_tsquery('app.french_unaccent', 'castor & barrage')
    from public.library_items i where i.id = tests.id('saved')$$,
  $$values (array[1::smallint], 1, true)$$,
  'saved versions have schema version 1, their keys, and a search document'
);
select throws_ok(
  $$select public.save_ai_job_to_library(tests.id('sub_job'), 'reading_passage', 'X',
    '[{"language_level_id": null, "content": {}}]')$$,
  '22023', null, 'only « Texte différencié » results are saved this way'
);
select tests.clear_authentication();

-- Texts saved in Phase 2 are converted once (the migration calls the same function).
-- A development database may hold more of them (« Texte différencié » saves the old format
-- until its save path moves to library content), so the count is taken on top of those.
create temporary table legacy_before on commit drop as
  select count(*)::int as n from public.library_item_versions
  where content ->> 'schema' = 'differentiated_text/v1';
insert into public.library_items (id, board_id, school_id, type, title, source, author_id) values
  (tests.remember('legacy', gen_random_uuid()), tests.id('board_a'), tests.id('school_a1'),
   'worksheet', 'Ancienne fiche', 'ai_generated', tests.id('teacher_a'));
insert into public.library_item_versions (id, item_id, language_level_id, content) values
  (tests.remember('legacy_base', gen_random_uuid()), tests.id('legacy'), null,
   '{"schema": "differentiated_text/v1", "original": true, "objective": "Lire", "title": "Fiche", "text": "Texte."}'),
  (tests.remember('legacy_level', gen_random_uuid()), tests.id('legacy'),
   tests.board_level('board_a', 'debutant'),
   '{"schema": "differentiated_text/v1", "objective": "Lire", "title": "Fiche", "text": "Texte simple.",
     "glossary": [{"term": "castor", "definition": ""}], "visualSupports": ["Une image"],
     "questions": ["Où vit le castor?", "Que mange-t-il?"], "teacherNote": "Lire à deux."}');
select is(app.library_convert_legacy_texts(), (select n + 2 from legacy_before),
  'both old versions are converted');
select results_eq(
  $$select content, schema_version::int from public.library_item_versions where id = tests.id('legacy_level')$$,
  $$values ('{"title": "Fiche", "objective": "Lire", "teacherNote": "Lire à deux.", "text": "Texte simple.",
      "glossary": [{"term": "castor", "definition": ""}], "visualSupports": ["Une image"],
      "instructions": "",
      "questions": [
        {"id": "q1", "kind": "short_answer", "prompt": "Où vit le castor?", "hint": "", "points": null,
         "category": null, "lines": 3},
        {"id": "q2", "kind": "short_answer", "prompt": "Que mange-t-il?", "hint": "", "points": null,
         "category": null, "lines": 3}]}'::jsonb, 1)$$,
  'questions become short answers with ids, and a worksheet gets its instructions'
);
select results_eq(
  $$select answer_key from public.library_item_answer_keys where version_id = tests.id('legacy_level')$$,
  $$values ('{"solution": "", "answers": [
      {"questionId": "q1", "kind": "short_answer", "sampleAnswer": "", "acceptableAnswers": [], "explanation": ""},
      {"questionId": "q2", "kind": "short_answer", "sampleAnswer": "", "acceptableAnswers": [], "explanation": ""}]}'::jsonb)$$,
  'the converted questions get a key that waits for sample answers'
);
select results_eq(
  $$select v.content -> 'questions', (select count(*)::int from public.library_item_answer_keys k
      where k.version_id = v.id)
    from public.library_item_versions v where v.id = tests.id('legacy_base')$$,
  $$values ('[]'::jsonb, 0)$$,
  'the original text has no questions and no key'
);

-- ---------------------------------------------------------------------------------------
-- 5. Substitute plans that may use an item are rebuilt (D-077)
-- ---------------------------------------------------------------------------------------

insert into public.absences (id, teacher_id, school_id, starts_on, ends_on, status, published_at) values
  (tests.remember('abs_a', gen_random_uuid()), tests.id('teacher_a'), tests.id('school_a1'),
   tests.school_day(7), tests.school_day(7), 'published', now()),
  (tests.remember('abs_other', gen_random_uuid()), tests.id('teacher_a_other'), tests.id('school_a1'),
   tests.school_day(7), tests.school_day(7), 'published', now());
insert into public.sub_plans (absence_id, plan_date, plan, review_deadline) values
  (tests.id('abs_other'), tests.school_day(7),
   jsonb_set(tests.plan_json(tests.school_day(7)), '{blocks}', jsonb_build_array(
     jsonb_build_object('library', jsonb_build_object('itemId', tests.id('plan_item'))))),
   tests.school_day(7) + time '07:30');

select tests.library_item('linked', 'teacher_a', 'worksheet', 'teacher_reviewed');
select tests.authenticate_as('teacher_a');
update public.unit_lessons set library_item_id = tests.id('linked') where id = tests.id('lesson_a3');
select public.library_share(tests.id('linked'), 'board');
select public.library_request_approval(tests.id('linked'));
select tests.clear_authentication();
update public.absences set sources_changed_at = null where id in (tests.id('abs_a'), tests.id('abs_other'));

select tests.authenticate_as('board_admin_a');
select public.library_decide(tests.id('linked'), 'approve', null, 1);
select tests.clear_authentication();
select is((select sources_changed_at from public.absences where id = tests.id('abs_a')), null,
  'approving a resource does not rebuild plans (the next rebuild picks it up)');

select tests.authenticate_as('board_admin_a');
select public.library_retract(tests.id('linked'), 'Une consigne manque.');
select tests.clear_authentication();
select results_eq(
  $$select id, sources_changed_at is not null from public.absences
    where id in (tests.id('abs_a'), tests.id('abs_other')) order by starts_on, teacher_id = tests.id('teacher_a') desc$$,
  $$values (tests.id('abs_a'), true), (tests.id('abs_other'), false)$$,
  'withdrawing a resource linked to her lesson marks the teacher''s upcoming absence out of date'
);

update public.absences set sources_changed_at = null where id in (tests.id('abs_a'), tests.id('abs_other'));
select tests.authenticate_as('teacher_a');
select public.library_archive(tests.id('plan_item'));
select tests.clear_authentication();
select results_eq(
  $$select sources_changed_at is not null from public.absences
    where id in (tests.id('abs_a'), tests.id('abs_other')) order by teacher_id = tests.id('teacher_a') desc$$,
  $$values (true), (true)$$,
  'archiving a resource marks the absences whose plans name it and whose lessons link it'
);

select tests.library_item('linked_draft', 'teacher_a', 'worksheet');
select tests.library_item('linked_reviewed', 'teacher_a', 'worksheet', 'teacher_reviewed');
select tests.authenticate_as('teacher_a');
update public.unit_lessons set library_item_id = tests.id('linked_draft') where id = tests.id('lesson_a3');
update public.unit_lessons set library_item_id = tests.id('linked_reviewed') where id = tests.id('new_lesson');
select tests.clear_authentication();
update public.absences set sources_changed_at = null where id = tests.id('abs_a');
select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('linked_draft'), 1,
  tests.with_board_levels(tests.library_payload('worksheet', 'Brouillon lié')));
select tests.clear_authentication();
select is((select sources_changed_at from public.absences where id = tests.id('abs_a')), null,
  'editing a draft changes no plan (plans use reviewed resources only)');
select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('linked_reviewed'), 1,
  tests.with_board_levels(tests.library_payload('worksheet', 'Fiche révisée')));
select tests.clear_authentication();
select isnt((select sources_changed_at from public.absences where id = tests.id('abs_a')), null,
  'editing a reviewed resource linked to a lesson marks the teacher''s absence out of date');

select * from finish();
rollback;
