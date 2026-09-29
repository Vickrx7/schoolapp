-- Phase 4 library AI: « Créer avec l'IA » and « Créer les versions manquantes avec l'IA »: who
-- may ask, the request built from ids by the database, the checks shared with every AI request,
-- and the answer turned into a private draft (or new versions) by the trigger on ai_jobs
-- (supabase/migrations/20261015090200_library_ai.sql; DECISIONS D-072, D-073, D-074, D-078,
-- D-079). The worker's part is played by superuser updates of ai_jobs, as
-- apps/worker/src/ai.ts writes them.
begin;
\ir _helpers.psql
select plan(54);
select tests.build_fixture();
select tests.build_library_fixture();

-- A request as the web server sends it: ids and choices only. `p_changes` replaces keys.
create function tests.ai_request(p_type text, p_changes jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'itemType', p_type,
    'gradeCodes', jsonb_build_array('3'),
    'subjectId', (select id from public.subjects where code = 'fra' and board_id is null),
    'expectationIds', jsonb_build_array(tests.id('exp_a')),
    'levelIds', '[]'::jsonb,
    'catholicReferenceId', null,
    'durationMinutes', 30,
    'subFriendly', false,
    'teacherNote', 'Un texte sur le huard.'
  ) || p_changes;
$$;

-- What the worker records when a job finishes: a usage row, then the job (finishJob).
create function tests.finish_job(p_job uuid, p_result jsonb)
returns void
language plpgsql
as $$
declare
  v_gen uuid;
begin
  insert into public.ai_generations (board_id, school_id, user_id, feature, prompt_version,
    provider, model, status)
  select j.board_id, j.school_id, j.user_id, j.feature, 'v1', 'fake', 'claude-opus-5-5', 'succeeded'
  from public.ai_jobs j where j.id = p_job
  returning id into v_gen;
  update public.ai_jobs
  set status = 'succeeded', result = p_result, sent_text = 'Type de ressource : …',
      ai_generation_id = v_gen, finished_at = now()
  where id = p_job;
end;
$$;

-- A version as the AI answers once normalized.
create function tests.ai_version(p_text text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'content', jsonb_build_object('title', '', 'objective', 'Trouver l’idée principale.',
      'teacherNote', '', 'text', p_text, 'glossary', '[]'::jsonb,
      'questions', jsonb_build_array(jsonb_build_object('id', 'q1', 'kind', 'short_answer',
        'prompt', 'De quoi parle le texte?', 'hint', '', 'points', null, 'category', null,
        'lines', 3)),
      'visualSupports', '[]'::jsonb),
    'answerKey', jsonb_build_object('solution', '', 'answers', jsonb_build_array(
      jsonb_build_object('questionId', 'q1', 'kind', 'short_answer',
        'sampleAnswer', 'Du huard.', 'acceptableAnswers', '[]'::jsonb, 'explanation', ''))));
$$;

-- The preview of a reading passage with two levels and a faith link, as the current user.
create function tests.item_preview()
returns jsonb
language sql
as $$
  select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('reading_passage',
    jsonb_build_object(
      'levelIds', jsonb_build_array(tests.id('ll_enrichi'), tests.id('ll_debutant')),
      'catholicReferenceId', tests.id('ref_a'),
      -- Labels sent by a client are never used.
      'gradeLabels', jsonb_build_array('CE2'), 'subjectLabel', 'Autre chose',
      'expectations', jsonb_build_array(jsonb_build_object('key', 'E1', 'text', 'Inventé')))));
$$;

grant execute on all functions in schema tests to authenticated;

select tests.remember('ll_debutant', tests.board_level('board_a', 'debutant'));
select tests.remember('ll_enrichi', tests.board_level('board_a', 'enrichi'));
select tests.remember('ll_b', tests.board_level('board_b', 'debutant'));

-- ---------------------------------------------------------------------------------------
-- 1. The features
-- ---------------------------------------------------------------------------------------

select lives_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input) values
      (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'library_item', '{}'),
      (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'library_levels', '{}')$$,
  'jobs accept the two library features'
);
delete from public.ai_jobs;
update public.schools set ai_enabled = true where id = tests.id('school_a1');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_ai_job(tests.id('school_a1'), 'library_item', tests.ai_request('quiz'))$$,
  '22023', null, 'the generic request stays limited to « Texte différencié »'
);

-- ---------------------------------------------------------------------------------------
-- 2. The preview: exactly what would be sent, built from the database
-- ---------------------------------------------------------------------------------------

select is(
  tests.item_preview() -> 'gradeLabels', '["3e année"]'::jsonb,
  'grade labels come from the database'
);
select is(tests.item_preview() ->> 'subjectLabel', 'Français', 'the subject label too');
select is(
  tests.item_preview() -> 'expectations',
  jsonb_build_array(jsonb_build_object('key', 'E1', 'expectationId', tests.id('exp_a'),
    'code', 'T1.2', 'text', 'Dégager l''idée principale d''un texte informatif.')),
  'attentes have keys, codes and texts from the curriculum'
);
select is(
  (select jsonb_agg(jsonb_build_array(l ->> 'key', l ->> 'label', l -> 'mostAccessible'))
   from jsonb_array_elements(tests.item_preview() -> 'levels') l),
  '[["L1", "Débutant", true], ["L2", "Enrichi", false]]'::jsonb,
  'levels are in their board order, keyed L1…, the most accessible marked'
);
select is(
  (tests.item_preview() -> 'catholic') - 'referenceId'::text,
  '{"key": "R1", "type": "virtue", "title": "Le respect", "text": "Respecter chaque personne."}'::jsonb,
  'the Catholic reference comes from the board''s list'
);
select is(
  tests.item_preview() ->> 'teacherNote', 'Un texte sur le huard.', 'the note is kept as typed'
);

-- ---------------------------------------------------------------------------------------
-- 3. Refusals
-- ---------------------------------------------------------------------------------------

select is(
  tests.error_of($$select public.request_library_item(tests.id('school_a1'), tests.ai_request('quiz',
    jsonb_build_object('expectationIds', jsonb_build_array(tests.id('exp_other')))))$$),
  '22023', 'an attente of another subject or grade is refused'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('quiz',
    jsonb_build_object('levelIds', jsonb_build_array(tests.id('ll_b')))))$$),
  '22023', 'another board''s level is refused'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('rubric',
    jsonb_build_object('levelIds', jsonb_build_array(tests.id('ll_debutant')))))$$),
  '22023', 'levels for a type without levels are refused'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('quiz',
    jsonb_build_object('catholicReferenceId', tests.id('ref_b'))))$$),
  '22023', 'another board''s Catholic reference is refused'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('quiz',
    jsonb_build_object('expectationIds', '[]'::jsonb)))$$),
  '22023', 'a quiz needs an attente'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('unit_test',
    jsonb_build_object('subFriendly', true)))$$),
  '22023', 'an end-of-unit test is never for a substitute'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('catholic_reflection',
    jsonb_build_object('expectationIds', '[]'::jsonb)))$$),
  '22023', 'a Catholic reflection needs a reference'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('essay'))$$),
  '22P02', 'an unknown type is refused'
);
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('quiz',
    jsonb_build_object('durationMinutes', 300)))$$),
  '22023', 'a duration over 4 hours is refused'
);
select lives_ok(
  $$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('brain_break',
    jsonb_build_object('expectationIds', '[]'::jsonb)))$$,
  'a brain break needs no attente'
);
select lives_ok(
  $$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('reading_passage',
    jsonb_build_object('levelIds', jsonb_build_array(tests.id('level_personal_a')))))$$,
  'a single level, the teacher''s own, is accepted'
);
select tests.authenticate_as('teacher_a_other');
select is(
  tests.error_of($$select public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('reading_passage',
    jsonb_build_object('levelIds', jsonb_build_array(tests.id('level_personal_a')))))$$),
  '22023', 'a colleague''s personal level is refused'
);
select tests.authenticate_as('office_a');
select throws_ok(
  $$select public.request_library_item(tests.id('school_a1'), tests.ai_request('quiz'))$$,
  '42501', null, 'office staff cannot ask'
);
select tests.clear_authentication();
update public.schools set ai_enabled = true where id = tests.id('school_a2');
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a2') and module = 'library';
select tests.authenticate_as('faith_reviewer_a');
select throws_ok(
  $$select public.request_library_item(tests.id('school_a2'), tests.ai_request('quiz'))$$,
  '42501', null, 'a school without the Library module cannot ask (it spends money)'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_library_item(tests.id('school_a2'), tests.ai_request('quiz'))$$,
  '42501', null, 'nor at a school where the teacher does not work'
);
select tests.clear_authentication();
update public.schools set ai_enabled = false where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_library_item(tests.id('school_a1'), tests.ai_request('quiz'))$$,
  'LXA01', null, 'AI off for the school is refused'
);
select tests.clear_authentication();
update public.schools set ai_enabled = true where id = tests.id('school_a1');

-- ---------------------------------------------------------------------------------------
-- 4. A resource written by the AI becomes the teacher's private draft
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('job_item', public.request_library_item(tests.id('school_a1'),
    tests.ai_request('reading_passage', jsonb_build_object(
      'levelIds', jsonb_build_array(tests.id('ll_debutant'), tests.id('ll_enrichi')),
      'catholicReferenceId', tests.id('ref_a')))))$$,
  'a teacher asks for a reading passage with two levels and a faith link'
);
select is(
  (select input from public.ai_jobs where id = tests.id('job_item')),
  public.library_item_ai_preview(tests.id('school_a1'), tests.ai_request('reading_passage',
    jsonb_build_object('levelIds', jsonb_build_array(tests.id('ll_debutant'), tests.id('ll_enrichi')),
      'catholicReferenceId', tests.id('ref_a')))),
  'the job holds exactly what the preview showed'
);
select tests.clear_authentication();

select tests.finish_job(tests.id('job_item'), jsonb_build_object(
  'title', 'Le huard, oiseau des lacs', 'summary', 'Un texte informatif.', 'keywords', 'huard, lecture',
  'durationMinutes', 32, 'materials', 'Crayons',
  'formats', jsonb_build_object('printable', true, 'projectable', true, 'interactive', false),
  'safetyNotes', null, 'catholicConnection', 'Le huard nous rappelle de respecter la nature.',
  'faithContent', false,
  'base', tests.ai_version('Le huard vit sur les lacs de l’Ontario.'),
  'levels', jsonb_build_array(
    tests.ai_version('Le huard vit sur les lacs.') || jsonb_build_object('level', 'L1'),
    tests.ai_version('Le huard, oiseau emblématique, vit sur les lacs.') || jsonb_build_object('level', 'L2'),
    tests.ai_version('Un niveau inconnu.') || jsonb_build_object('level', 'L9'))));

select tests.remember('ai_item', (select (result ->> 'itemId')::uuid from public.ai_jobs where id = tests.id('job_item')));
select is(
  (select status::text from public.ai_jobs where id = tests.id('job_item')), 'succeeded',
  'the job succeeded and names the new resource'
);
select results_eq(
  $$select author_id, status::text, share_scope::text, source::text, prompt_version, model,
      ai_generation_id is not null, title, duration_minutes::int, school_id
    from public.library_items where id = tests.id('ai_item')$$,
  $$values (tests.id('teacher_a'), 'draft', 'private', 'ai_generated', 'v1', 'claude-opus-5-5', true,
      'Le huard, oiseau des lacs', 32, tests.id('school_a1'))$$,
  'the resource is the teacher''s private AI draft, with its provenance'
);
select results_eq(
  $$select subject_id, catholic_reference_id, catholic_connection is not null, requires_faith_review
    from public.library_items where id = tests.id('ai_item')$$,
  $$values ((select id from public.subjects where code = 'fra' and board_id is null), tests.id('ref_a'),
      true, true)$$,
  'subject, reference and faith link are kept, and the faith review applies'
);
select is(
  (select array_agg(grade_code) from public.library_item_grades where item_id = tests.id('ai_item')),
  array['3'], 'the grades of the request'
);
select is(
  (select array_agg(expectation_id) from public.library_item_expectations where item_id = tests.id('ai_item')),
  array[tests.id('exp_a')], 'the attentes of the request'
);
select results_eq(
  $$select v.language_level_id, k.version_id is not null, v.schema_version
    from public.library_item_versions v
    left join public.library_item_answer_keys k on k.version_id = v.id
    where v.item_id = tests.id('ai_item')
    order by v.language_level_id nulls first$$,
  $$select * from (values (null::uuid, true, 1::smallint), (tests.id('ll_debutant'), true, 1::smallint),
      (tests.id('ll_enrichi'), true, 1::smallint)) t order by 1 nulls first$$,
  'the base version and the two levels asked for, each with its key; an unknown level is skipped'
);
select ok(
  (select search_document @@ to_tsquery('app.french_unaccent', 'huard') from public.library_items
   where id = tests.id('ai_item')),
  'the new resource is searchable by its author'
);
select is(
  (select count(*)::int from public.audit_log where action = 'library_item.generated'
     and entity_id = tests.id('ai_item')
     and details = jsonb_build_object('ai_job_id', tests.id('job_item'), 'author_id', tests.id('teacher_a'))),
  1, 'generating is audited with the job and the author only'
);

select tests.authenticate_as('teacher_a');
select is(
  (select count(*)::int from public.library_items where id = tests.id('ai_item')), 1,
  'the author reads her draft'
);
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.library_items where id = tests.id('ai_item')), 0,
  'a reviewer does not (a private draft)'
);

-- An answer that cannot be stored fails the job and leaves nothing behind.
select tests.authenticate_as('teacher_a');
select tests.remember('job_bad', public.request_library_item(tests.id('school_a1'), tests.ai_request('quiz')));
select tests.clear_authentication();
create temporary table item_count on commit drop as select count(*) as n from public.library_items;
select tests.finish_job(tests.id('job_bad'), jsonb_build_object('title', 'Quiz', 'base',
  jsonb_build_object('content', 'pas un objet', 'answerKey', null), 'levels', '[]'::jsonb));
select results_eq(
  $$select status::text, error_code, result is null from public.ai_jobs where id = tests.id('job_bad')$$,
  $$values ('failed', 'invalidOutput', true)$$,
  'a malformed answer turns the job into invalidOutput'
);
select is(
  (select count(*) from public.library_items), (select n from item_count),
  'and creates no resource'
);

-- ---------------------------------------------------------------------------------------
-- 5. Versions per level for a resource the teacher may edit
-- ---------------------------------------------------------------------------------------

select tests.library_item('game', 'teacher_a', 'game');
select tests.library_item('passage', 'teacher_a', 'reading_passage');
select tests.library_item('approved', 'teacher_a', 'game', 'board_approved', 'board');
select tests.library_item('shared_game', 'teacher_a', 'game', 'teacher_reviewed', 'school', 'school_a1');
select tests.library_item('rubric', 'teacher_a', 'rubric');
select tests.library_item('no_base', 'teacher_a', 'game');
delete from public.library_item_versions where item_id = tests.id('no_base');

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.request_library_levels(tests.id('game'), tests.id('school_a1'),
    array[tests.id('ll_debutant')])$$,
  '42501', null, 'only someone who may edit the resource asks for its levels'
);
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_library_levels(tests.id('approved'), tests.id('school_a1'),
    array[tests.id('ll_debutant')])$$,
  '42501', null, 'an approved resource is read-only'
);
select throws_ok(
  $$select public.library_levels_ai_preview(tests.id('passage'), tests.id('school_a1'),
    array[tests.id('ll_debutant')])$$,
  'LXL09', null, 'a level the resource already has is refused'
);
select throws_ok(
  $$select public.library_levels_ai_preview(tests.id('rubric'), tests.id('school_a1'),
    array[tests.id('ll_debutant')])$$,
  '22023', null, 'a type without levels is refused'
);
select is(
  tests.error_of($$select public.library_levels_ai_preview(tests.id('no_base'), tests.id('school_a1'),
    array[tests.id('ll_debutant')])$$),
  'LXL01 base', 'a resource without a base version is refused'
);
select throws_ok(
  $$select public.library_levels_ai_preview(tests.id('shared_game'), tests.id('school_a1'),
    array[tests.id('level_personal_a')])$$,
  'LXL10', null, 'a personal level is refused on a shared resource'
);
select is(
  (select jsonb_build_array(p ->> 'baseRevision', p -> 'levels' -> 0 ->> 'label', p -> 'base' ? 'content',
     p ? 'itemId')
   from public.library_levels_ai_preview(tests.id('game'), tests.id('school_a1'),
     array[tests.id('ll_enrichi'), tests.id('ll_debutant')]) p),
  '["1", "Débutant", true, true]'::jsonb,
  'the preview holds the revision, the levels in order and the base version'
);

select tests.remember('job_levels', public.request_library_levels(tests.id('game'), tests.id('school_a1'),
  array[tests.id('ll_debutant'), tests.id('ll_enrichi')]));
select is(
  public.request_library_levels(tests.id('game'), tests.id('school_a1'),
    array[tests.id('ll_debutant'), tests.id('ll_enrichi')]),
  tests.id('job_levels'),
  'a second tap while the request runs returns it'
);
select tests.clear_authentication();
-- Meanwhile the Enrichi version was written by hand: only the missing level is added.
insert into public.library_item_versions (item_id, language_level_id, content)
values (tests.id('game'), tests.id('ll_enrichi'), '{"title": "", "objective": "", "teacherNote": ""}');
select tests.finish_job(tests.id('job_levels'), jsonb_build_object('levels', jsonb_build_array(
  tests.ai_version('Version plus simple.') || jsonb_build_object('level', 'L1'),
  tests.ai_version('Version plus riche.') || jsonb_build_object('level', 'L2'))));
select results_eq(
  $$select status::text, result ->> 'itemId', result ->> 'levelsAdded' from public.ai_jobs
    where id = tests.id('job_levels')$$,
  $$values ('succeeded', tests.id('game')::text, '1')$$,
  'the job succeeds and names the resource'
);
select is(
  (select count(*)::int from public.library_item_versions
   where item_id = tests.id('game') and language_level_id = tests.id('ll_debutant')),
  1, 'the missing level was added'
);
select is(
  (select content ->> 'text' from public.library_item_versions
   where item_id = tests.id('game') and language_level_id = tests.id('ll_enrichi')),
  null, 'the level written meanwhile is kept as it was'
);
select results_eq(
  $$select content_revision from public.library_items where id = tests.id('game')$$,
  $$values (2)$$,
  'adding versions is a content change (a new revision)'
);
select is(
  (select details from public.audit_log where action = 'library_item.levels_generated'
     and entity_id = tests.id('game')),
  jsonb_build_object('ai_job_id', tests.id('job_levels'), 'count', 1),
  'adding levels is audited with the job and a count'
);

-- A result arriving after the resource changed is not applied.
select tests.authenticate_as('teacher_a');
select tests.remember('job_stale', public.request_library_levels(tests.id('passage'), tests.id('school_a1'),
  array[tests.id('level_personal_a')]));
select tests.clear_authentication();
update public.library_items set content_revision = content_revision + 1 where id = tests.id('passage');
select tests.finish_job(tests.id('job_stale'), jsonb_build_object('levels', jsonb_build_array(
  tests.ai_version('Ma version.') || jsonb_build_object('level', 'L1'))));
select results_eq(
  $$select status::text, error_code from public.ai_jobs where id = tests.id('job_stale')$$,
  $$values ('failed', 'libraryChanged')$$,
  'a result for a resource that changed since fails with libraryChanged'
);
select is(
  (select count(*)::int from public.library_item_versions
   where item_id = tests.id('passage') and language_level_id = tests.id('level_personal_a')),
  0, 'and adds nothing'
);

-- A reviewed resource shared with the whole board, faith-reviewed: nobody else uses what the AI
-- wrote before its author has read it (20261015090400_library_review_fixes.sql).
select tests.library_item('shared_levels', 'teacher_a', 'game', 'teacher_reviewed', 'board', 'school_a1');
update public.library_items
set faith_content = true, faith_reviewed_at = now(), faith_reviewed_by = tests.id('faith_reviewer_a')
where id = tests.id('shared_levels');
select tests.authenticate_as('teacher_a');
select tests.remember('job_shared', public.request_library_levels(tests.id('shared_levels'),
  tests.id('school_a1'), array[tests.id('ll_debutant')]));
select tests.clear_authentication();
select tests.finish_job(tests.id('job_shared'), jsonb_build_object('levels', jsonb_build_array(
  tests.ai_version('Version plus simple.') || jsonb_build_object('level', 'L1'))));
select results_eq(
  $$select j.status::text, j.result ->> 'levelsAdded', i.status::text, i.share_scope::text,
      i.faith_reviewed_at is null,
      (select count(*)::int from public.audit_log a
       where a.action = 'library_item.returned_to_draft' and a.entity_id = i.id
         and a.details = '{"scope": "board", "reason": "ai_levels"}'::jsonb)
    from public.ai_jobs j join public.library_items i on i.id = tests.id('shared_levels')
    where j.id = tests.id('job_shared')$$,
  $$values ('succeeded', '1', 'draft', 'private', true, 1)$$,
  'versions from the AI make a shared, reviewed resource a private draft for its author to read (audited)'
);

select * from finish();
rollback;
