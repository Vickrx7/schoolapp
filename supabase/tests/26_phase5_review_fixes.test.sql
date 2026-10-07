-- Phase 5 hardening (supabase/migrations/20261101090500_phase5_review_fixes.sql): option ids
-- that carry no answer, board deletions audited, and pack items deleted here never re-created.
-- DECISIONS: D-086, D-091, D-100. (Opinions: 22_library_growth; the projector with answers
-- hidden: 20_class_mode.)
begin;
\ir _helpers.psql
\ir _class_mode_helpers.psql
select plan(23);
select tests.build_fixture();
select tests.build_library_fixture();
\ir _content_packs_helpers.psql

-- How many rows a delete of an item removes as the current role (row level security decides).
create function tests.delete_item(p_item text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  delete from public.library_items where id = tests.id(p_item);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function tests.delete_item(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 1. Option ids per session (D-086). A quiz as the Phase 4 editor saves it: ordering items and
--    matching pairs numbered in the answer's order, their positions scrambled; the right choice
--    written first (c1), then moved to the second place.
-- ---------------------------------------------------------------------------------------

select tests.library_item('editor_quiz', 'teacher_a', 'quiz', 'board_approved', 'board', 'school_a1');
update public.library_item_versions set content = jsonb_build_object(
  'title', '', 'objective', '', 'teacherNote', '', 'instructions', '',
  'questions', jsonb_build_array(
    jsonb_build_object('id', 'q1', 'kind', 'multiple_choice', 'prompt', 'Combien font 6 × 7?',
      'hint', '', 'points', null, 'category', null, 'multipleAnswers', false,
      'choices', jsonb_build_array(
        jsonb_build_object('id', 'c3', 'text', '48'),
        jsonb_build_object('id', 'c1', 'text', '42'),
        jsonb_build_object('id', 'c2', 'text', '36'))),
    jsonb_build_object('id', 'q2', 'kind', 'ordering', 'prompt', 'Du plus petit au plus grand.',
      'hint', '', 'points', null, 'category', null,
      'items', jsonb_build_array(
        jsonb_build_object('id', 'i2', 'text', '45'),
        jsonb_build_object('id', 'i3', 'text', '310'),
        jsonb_build_object('id', 'i1', 'text', '12'),
        jsonb_build_object('id', 'i4', 'text', '999'),
        jsonb_build_object('id', 'i5', 'text', '1000'))),
    jsonb_build_object('id', 'q3', 'kind', 'matching', 'prompt', 'Associe.',
      'hint', '', 'points', null, 'category', null,
      'left', jsonb_build_array(
        jsonb_build_object('id', 'l1', 'text', 'un'),
        jsonb_build_object('id', 'l2', 'text', 'deux'),
        jsonb_build_object('id', 'l3', 'text', 'trois')),
      'right', jsonb_build_array(
        jsonb_build_object('id', 'r2', 'text', '2'),
        jsonb_build_object('id', 'r3', 'text', '3'),
        jsonb_build_object('id', 'r1', 'text', '1')))))
where item_id = tests.id('editor_quiz') and language_level_id is null;
update public.library_item_answer_keys set answer_key = jsonb_build_object(
  'answers', jsonb_build_array(
    jsonb_build_object('questionId', 'q1', 'kind', 'multiple_choice',
      'correctChoiceIds', jsonb_build_array('c1'), 'explanation', ''),
    jsonb_build_object('questionId', 'q2', 'kind', 'ordering',
      'orderedIds', jsonb_build_array('i1', 'i2', 'i3', 'i4', 'i5'), 'explanation', ''),
    jsonb_build_object('questionId', 'q3', 'kind', 'matching', 'pairs', jsonb_build_array(
        jsonb_build_object('leftId', 'l1', 'rightId', 'r1'),
        jsonb_build_object('leftId', 'l2', 'rightId', 'r2'),
        jsonb_build_object('leftId', 'l3', 'rightId', 'r3')), 'explanation', '')),
  'solution', '')
where version_id = (select id from public.library_item_versions
                    where item_id = tests.id('editor_quiz') and language_level_id is null);

select tests.authenticate_as('teacher_a');
select tests.remember('s', (select session_id from public.start_class_session(
  tests.id('class_a'), tests.id('editor_quiz'), null, 'solo', p_replace_open => true)));
select tests.clear_authentication();

select is_empty(
  $$select q.q ->> 'id', l.list, o.n, o.o ->> 'id'
    from public.class_sessions s
    cross join lateral jsonb_array_elements(s.questions) q (q)
    cross join lateral unnest(array['choices', 'left', 'right', 'items']) l (list)
    cross join lateral jsonb_array_elements(coalesce(q.q -> l.list, '[]'::jsonb)) with ordinality o (o, n)
    where s.id = tests.id('s')
      and o.o ->> 'id' is distinct from app.class_mode_option_id(l.list, o.n::integer)$$,
  'every option a device sees is named by its list and its place on screen only'
);
select results_eq(
  $$select q.q -> 'choices', q.q -> 'items' -> 0, q.q -> 'right'
    from public.class_sessions s, jsonb_array_elements(s.questions) q (q)
    where s.id = tests.id('s') order by q.q ->> 'id'$$,
  $$values
    ('[{"id": "a", "text": "48"}, {"id": "b", "text": "42"}, {"id": "c", "text": "36"}]'::jsonb, null::jsonb, null::jsonb),
    (null, '{"id": "i1", "text": "45"}', null),
    (null, null, '[{"id": "r1", "text": "2"}, {"id": "r2", "text": "3"}, {"id": "r3", "text": "1"}]')$$,
  'the options keep their text and their order on screen'
);
select results_eq(
  $$select k.answers -> 'q1' -> 'choiceIds', k.answers -> 'q2' -> 'orderedIds', k.answers -> 'q3' -> 'pairs'
    from public.class_session_keys k where k.session_id = tests.id('s')$$,
  $$values ('["b"]'::jsonb, '["i3", "i1", "i2", "i4", "i5"]'::jsonb,
            '{"l1": "r3", "l2": "r1", "l3": "r2"}'::jsonb)$$,
  'the session''s key is written with the session''s ids'
);
select ok(
  (select (k.answers -> 'q2' -> 'orderedIds') <> (
            select jsonb_agg(o ->> 'id' order by o ->> 'id')
            from jsonb_array_elements(s.questions -> 1 -> 'items') o)
      and not exists (
            select 1 from jsonb_each_text(k.answers -> 'q3' -> 'pairs') p
            where substr(p.key, 2) = substr(p.value, 2))
   from public.class_sessions s join public.class_session_keys k on k.session_id = s.id
   where s.id = tests.id('s')),
  'sorting the ids no longer gives the order, and l_n no longer pairs with r_n'
);
select ok(
  (select bool_and((q.q ->> 'scorable')::boolean)
   from public.class_sessions s, jsonb_array_elements(s.questions) q (q) where s.id = tests.id('s')),
  'every question is still scored'
);

-- A device plays it with the ids it sees.
select is(tests.play(tests.id('s'), 1, 'e'), 1, 'a device joins');
select tests.authenticate_as('teacher_a');
select tests.control('s', 'next');
select tests.clear_authentication();
select is(tests.portal_answer('e1', 0, '{"choiceIds": ["c1"]}') ->> 'outcome', 'invalid',
  'the content''s id of the right choice means nothing in the session');
select is(tests.portal_answer('e1', 0, '{"choiceIds": ["b"]}') ->> 'outcome', 'recorded',
  'the choice it sees is taken');
select tests.authenticate_as('teacher_a');
select is(tests.control('s', 'reveal') -> 'reveal' -> 'answer' -> 'choiceIds', '["b"]'::jsonb,
  'the projector marks the right choice with the session''s id');
select tests.control('s', 'next');
select tests.clear_authentication();
select is(tests.portal_answer('e1', 1, '{"orderedIds": ["i3", "i1", "i2", "i4", "i5"]}') ->> 'outcome',
  'recorded', 'an ordering in the session''s ids is taken');
select tests.authenticate_as('teacher_a');
select tests.control('s', 'reveal');
select tests.control('s', 'next');
select tests.clear_authentication();
select is(tests.portal_answer('e1', 2, '{"pairs": {"l1": "r3", "l2": "r1", "l3": "r2"}}') ->> 'outcome',
  'recorded', 'pairs in the session''s ids are taken');
select results_eq(
  $$select r.question_index::integer, r.score::integer, r.is_correct
    from public.session_responses r where r.session_id = tests.id('s') order by 1$$,
  $$values (0, 100, true), (1, 100, true), (2, 100, true)$$,
  'right answers in the session''s ids earn their points'
);

-- ---------------------------------------------------------------------------------------
-- 2. Deleting a board item is audited (D-091)
-- ---------------------------------------------------------------------------------------

select tests.library_item('board_draft', null, 'worksheet');
select tests.library_item('board_old', null, 'worksheet', 'board_approved', 'board', 'school_a1');
select tests.library_item('own_draft', 'teacher_a', 'worksheet');
-- board_old was approved through the review (its audit line), and 3 units use it.
update public.library_items set usage_count = 3 where id = tests.id('board_old');
select app.log_audit('library_item.approved', tests.id('board_a'), tests.id('school_a1'),
  'library_item', tests.id('board_old'), '{}'::jsonb);

select tests.authenticate_as('board_admin_a');
select lives_ok($$select public.library_archive(tests.id('board_old'))$$,
  'a reviewer archives an approved board item (archiving clears its approval)');
select is(tests.delete_item('board_draft') + tests.delete_item('board_old'), 2,
  'the board''s content reviewer deletes a board draft and an archived board item');
select tests.clear_authentication();
select results_eq(
  $$select a.entity_id, a.actor_user_id, a.details ->> 'status', (a.details ->> 'ever_approved')::boolean,
      (a.details ->> 'usage_count')::integer
    from public.audit_log a where a.action = 'library_item.deleted' order by a.id$$,
  $$values (tests.id('board_draft'), tests.id('board_admin_a'), 'draft', false, 0),
           (tests.id('board_old'), tests.id('board_admin_a'), 'archived', true, 3)$$,
  'each deletion is audited with its status, whether it was ever approved and its usage'
);
select tests.authenticate_as('teacher_a');
select is(tests.delete_item('own_draft'), 1, 'a teacher deletes her own draft');
select tests.clear_authentication();
select is((select count(*)::integer from public.audit_log
           where action = 'library_item.deleted' and entity_id = tests.id('own_draft')), 0,
  '… which stays her own business (only board items are audited)');

-- ---------------------------------------------------------------------------------------
-- 3. A pack item deleted here is never created again by a later version (D-100)
-- ---------------------------------------------------------------------------------------

select tests.keep_report('v1-items', jsonb_build_array(
  tests.pack_rehash(jsonb_set(tests.pack_item('garde', 'worksheet'), '{versions}',
    jsonb_build_array(tests.pack_item('garde', 'worksheet') #> '{versions,0}'))),
  tests.pack_rehash(jsonb_set(tests.pack_item('jetee', 'worksheet'), '{versions}',
    jsonb_build_array(tests.pack_item('jetee', 'worksheet') #> '{versions,0}')))));
select set_config('role', 'service_role', true);
select tests.keep_report('v1', public.content_pack_apply(
  tests.stage_pack('board_a', 'tombe', '2026.1', tests.report('v1-items')), '{}'));
select tests.clear_authentication();
select tests.remember('jetee', tests.pack_item_id('tombe', 'jetee'));

select tests.authenticate_as('board_admin_a');
select is(tests.delete_item('jetee'), 1,
  'the board''s reviewer deletes an imported draft');
select tests.clear_authentication();
select results_eq(
  $$select pack_slug, pack_item_key from public.content_pack_removed_items where board_id = tests.id('board_a')$$,
  $$values ('tombe', 'jetee')$$,
  'its pack key is remembered (no content, no person)'
);
select results_eq(
  $$select a.details ->> 'pack_slug', a.details ->> 'pack_item_key'
    from public.audit_log a where a.action = 'library_item.deleted' and a.entity_id = tests.id('jetee')$$,
  $$values ('tombe', 'jetee')$$,
  'the deletion is audited with its pack key'
);

select tests.keep_report('v2-items', (
  select jsonb_agg(tests.pack_rehash(x || '{"summary": "Deuxième version."}') order by x ->> 'key')
  from jsonb_array_elements(tests.report('v1-items')) x));
select set_config('role', 'service_role', true);
select tests.keep_report('preview-2', public.content_pack_preview(
  tests.stage_pack('board_a', 'tombe', '2026.2', tests.report('v2-items')), '{}'));
select tests.keep_report('v2', public.content_pack_apply(
  tests.stage_pack('board_a', 'tombe', '2026.2', tests.report('v2-items')), '{}'));
select tests.clear_authentication();

select results_eq(
  $$select key, outcome from tests.pack_outcomes(tests.report('v2')) order by key collate "C"$$,
  $$values ('garde', 'update'), ('jetee', 'skipped_deleted_locally')$$,
  'the next version updates the item kept and does not bring back the one deleted here'
);
select results_eq(
  $$select (tests.report('preview-2') -> 'counts' ->> 'skippedDeletedLocally')::integer,
      (tests.report('v2') -> 'counts' ->> 'skippedDeletedLocally')::integer,
      tests.report('v2') -> 'counts' ->> 'created',
      (select report -> 'skippedDeletedLocally' from public.content_packs
       where id = (tests.report('v2') ->> 'packId')::uuid),
      (select count(*)::integer from public.library_items
       where board_id = tests.id('board_a') and pack_slug = 'tombe')$$,
  $$values (1, 1, '0', '["jetee"]'::jsonb, 1)$$,
  'the dry run and the report say so, and the board still has one item of the pack'
);
select is(
  (select (details ->> 'skipped')::integer from public.audit_log
   where action = 'content_pack.imported' and entity_id = (tests.report('v2') ->> 'packId')::uuid),
  1, 'the import''s audit counts it as skipped'
);

select * from finish();
rollback;
