-- Phase 5 library growth: the board's own items, adaptations (« Adapter ») with their sharing cap
-- and credit line, and opinions (« Votre avis ») with usage
-- (supabase/migrations/20261101090100_library_growth.sql; DECISIONS D-091 to D-093).
begin;
\ir _helpers.psql
\ir _library_growth_helpers.psql
select plan(64);
select tests.build_fixture();
select tests.build_library_fixture();

update public.users set honorific = 'Mme' where id = tests.id('teacher_a');
update public.schools set short_name = 'É.É.C. A1' where id = tests.id('school_a1');

-- ---------------------------------------------------------------------------------------
-- 1. The board's own items (D-091)
-- ---------------------------------------------------------------------------------------

select is_empty(
  $$select id from public.library_items
    where source = 'board_created' and author_id is null and not board_owned$$,
  'every board item without an author is board-owned after the backfill'
);
select throws_ok(
  $$insert into public.library_items (board_id, type, title, source, author_id, board_owned)
    values (tests.id('board_a'), 'worksheet', 'X', 'board_created', tests.id('teacher_a'), true)$$,
  '23514', null, 'a board-owned item has no author'
);

select tests.library_item('board_draft', null, 'worksheet');
select tests.library_item('board_draft2', null, 'worksheet');
select is((select board_owned from public.library_items where id = tests.id('board_draft')), true,
  'the fixture writes board items as the board''s own');

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('board_draft')),
      (select count(*)::int from public.library_item_versions where item_id = tests.id('board_draft')),
      tests.error_of($q$select public.save_library_item(tests.id('board_draft'), 1,
        tests.library_payload('worksheet', 'Fiche du conseil'))$q$)$$,
  $$values (1, 5, null::text)$$,
  'the content reviewer reads and edits a board draft'
);
select is_empty(
  $$select * from public.library_item_lineage(tests.id('board_draft'))$$,
  'a board item that is not an adaptation has no credit line'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('board_draft')),
      tests.error_of($q$select public.save_library_item(tests.id('board_draft'), 2,
        tests.library_payload('worksheet', 'Fiche du conseil'))$q$)$$,
  $$values (0, '42501')$$,
  'a teacher neither reads nor edits a board draft'
);
select is(
  tests.growth_delete('board_draft2'),
  0, 'a teacher deletes no board draft'
);
select tests.clear_authentication();

-- An item whose author was deleted is not the board's: nobody reads it (D-065).
select tests.create_user('leaving');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('leaving'), 'teacher', tests.id('board_a'), tests.id('school_a1'));
select tests.library_item('orphan', 'leaving', 'worksheet');
delete from auth.users where id = tests.id('leaving');
select results_eq(
  $$select author_id, board_owned from public.library_items where id = tests.id('orphan')$$,
  $$values (null::uuid, false)$$,
  'an item whose author was deleted keeps no author and is not the board''s'
);
select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.library_items where id = tests.id('orphan')), 0,
  'the content reviewer cannot read an orphaned private draft');
select is(
  tests.growth_delete('orphan'),
  0, 'nor delete it'
);
select is(
  tests.growth_delete('board_draft2'),
  1, 'the content reviewer deletes a board draft'
);
select tests.clear_authentication();

-- Approving a board item makes it board-wide, without a school.
select tests.library_item('board_ready', null, 'worksheet', 'teacher_reviewed', 'private', 'school_a1');
select tests.library_request('board_ready');
select tests.authenticate_as('board_admin_a');
select lives_ok(
  $$select public.library_decide(tests.id('board_ready'), 'approve', null, 1)$$,
  'the content reviewer approves a board item'
);
select tests.clear_authentication();
select results_eq(
  $$select status::text, share_scope::text, school_id, board_owned
    from public.library_items where id = tests.id('board_ready')$$,
  $$values ('board_approved', 'board', null::uuid, true)$$,
  'an approved board item is shared with the whole board'
);
select throws_ok(
  $$update public.library_items set board_owned = false where id = tests.id('board_ready')$$,
  '22023', null, 'a board item stays the board''s'
);
select tests.authenticate_as('board_admin_a');
select is(
  tests.growth_delete('board_ready'),
  0, 'an approved board item cannot be deleted'
);
select is(app.am_library_reviewer(tests.id('board_a'), 'content'), true,
  'am_library_reviewer answers for the current user');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. « Adapter » (D-092)
-- ---------------------------------------------------------------------------------------

-- teacher_a's quiz shared with her school, with a tag, a licence and a version for her own
-- personal level (written directly: the functions would refuse it); and her reading passage with
-- faith content a reviewer flagged.
select tests.library_item('shared_a', 'teacher_a', 'quiz', 'teacher_reviewed', 'school', 'school_a1');
insert into public.library_item_tags (item_id, tag_id) values (tests.id('shared_a'), tests.id('tag_global'));
update public.library_items set licence = 'CC BY 4.0', sub_friendly = true
where id = tests.id('shared_a');
select tests.growth_version('shared_a', tests.id('level_personal_a'));
select tests.library_item('faith_a', 'teacher_a', 'reading_passage', 'teacher_reviewed', 'school',
  'school_a1');
update public.library_items set faith_content = true, faith_flagged_by = tests.id('board_admin_a')
where id = tests.id('faith_a');
select tests.remember(k, gen_random_uuid())
from unnest(array['copy', 'faith_copy', 'own_copy', 'board_copy', 'pack_copy', 'copy_of_copy',
  'unused']) k;

select tests.authenticate_as('teacher_a_other');
select is(public.remix_library_item(tests.id('shared_a'), tests.id('copy')), tests.id('copy'),
  'a colleague adapts a resource shared with her school');
select tests.clear_authentication();
select results_eq(
  $$select status::text, share_scope::text, source::text, author_id, parent_item_id, parent_title,
      share_cap::text, share_cap_school_id, school_id, licence, sub_friendly, content_pack_id,
      prompt_version
    from public.library_items where id = tests.id('copy')$$,
  $$values ('draft', 'private', 'teacher_created', tests.id('teacher_a_other'), tests.id('shared_a'),
      'Ressource shared_a', 'school', tests.id('school_a1'), tests.id('school_a1'), 'CC BY 4.0', false,
      null::uuid, null::text)$$,
  'the copy is her private draft, credited to its original and capped to its school'
);
select tests.authenticate_as('teacher_a_other');
select is(public.remix_library_item(tests.id('faith_a'), tests.id('faith_copy')), tests.id('faith_copy'),
  'a colleague adapts a resource with faith content');
select tests.clear_authentication();
select results_eq(
  $$select faith_content, faith_flagged_by, requires_faith_review, faith_reviewed_at
    from public.library_items where id = tests.id('faith_copy')$$,
  $$values (true, null::uuid, true, null::timestamptz)$$,
  'the faith flag is copied, not who flagged it, and the faith review applies again'
);
select results_eq(
  $$select
      (select count(*)::int from public.library_item_versions where item_id = tests.id('copy')),
      (select count(*)::int from public.library_item_versions v
       join public.library_item_answer_keys k on k.version_id = v.id where v.item_id = tests.id('copy')),
      (select count(*)::int from public.library_item_versions
       where item_id = tests.id('copy') and language_level_id = tests.id('level_personal_a')),
      (select count(*)::int from public.library_item_versions where item_id = tests.id('shared_a'))$$,
  $$values (5, 5, 0, 6)$$,
  'the base and board-level versions are copied with their keys, not the author''s personal level'
);
select results_eq(
  $$select array(select grade_code from public.library_item_grades where item_id = tests.id('copy')),
      array(select expectation_id from public.library_item_expectations where item_id = tests.id('copy')),
      array(select tag_id from public.library_item_tags where item_id = tests.id('copy')),
      (select search_document <> ''::tsvector from public.library_items where id = tests.id('copy'))$$,
  $$values (array['3']::text[], array[tests.id('exp_a')], array[tests.id('tag_global')], true)$$,
  'grades, attentes and tags are copied, and the copy is searchable'
);
select results_eq(
  $$select actor_user_id, board_id, details from public.audit_log
    where action = 'library_item.remixed' and entity_id = tests.id('copy')$$,
  $$values (tests.id('teacher_a_other'), tests.id('board_a'),
      jsonb_build_object('parent_item_id', tests.id('shared_a')))$$,
  'adapting is audited with the original''s id only'
);

select tests.authenticate_as('teacher_a_other');
select is(public.remix_library_item(tests.id('shared_a'), tests.id('copy')), tests.id('copy'),
  'the same request sent again returns the same copy');
select is((select count(*)::int from public.library_items where parent_item_id = tests.id('shared_a')), 1,
  'and makes no second copy');
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('copy'), true)$$,
  'the adaptation can be marked reviewed'
);
select throws_ok(
  $$select public.library_share(tests.id('copy'), 'board')$$,
  'LXM03', null, 'an adaptation of a school resource cannot be shared with the whole board'
);
select throws_ok(
  $$select public.library_request_approval(tests.id('copy'))$$,
  'LXM03', null, 'nor proposed to the board'
);
select lives_ok(
  $$select public.library_share(tests.id('copy'), 'school', tests.id('school_a1'))$$,
  'it can be shared with the original''s school'
);
select throws_ok(
  $$update public.library_items set share_cap = null where id = tests.id('copy')$$,
  '42501', null, 'the cap cannot be written through the API'
);
select tests.clear_authentication();
select throws_ok(
  $$update public.library_items set share_scope = 'board' where id = tests.id('copy')$$,
  'LXM03', null, 'the cap holds on every write path'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.remix_library_item(tests.id('shared_a'), tests.id('copy'))$$,
  '42501', null, 'another user cannot reuse an id already taken'
);
select tests.clear_authentication();

-- A copy of a capped copy keeps the cap.
select tests.authenticate_as('subject_teacher');
select is(public.remix_library_item(tests.id('copy'), tests.id('copy_of_copy')), tests.id('copy_of_copy'),
  'a colleague adapts the shared adaptation');
select tests.clear_authentication();
select results_eq(
  $$select share_cap::text, share_cap_school_id, parent_item_id, parent_title
    from public.library_items where id = tests.id('copy_of_copy')$$,
  $$values ('school', tests.id('school_a1'), tests.id('copy'), 'Ressource shared_a')$$,
  'a copy of a capped adaptation keeps the cap and credits its direct parent'
);

-- Refusals.
select tests.library_item('private_a', 'teacher_a', 'worksheet');
select tests.library_item('archived_a', 'teacher_a', 'worksheet', 'archived');
select tests.library_item('licensed', null, 'worksheet', 'board_approved', 'board');
update public.library_items set no_derivatives = true where id = tests.id('licensed');
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  format('select public.remix_library_item(%L, %L)', tests.id('private_a'), tests.id('unused')),
  '42501', null, 'a colleague''s private draft cannot be adapted'
);
select throws_ok(
  format('select public.remix_library_item(%L, %L)', tests.id('licensed'), tests.id('unused')),
  'LXM02', null, 'a resource whose licence forbids it cannot be adapted'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select throws_ok(
  format('select public.remix_library_item(%L, %L)', tests.id('archived_a'), tests.id('unused')),
  'LXM01', null, 'an archived resource cannot be adapted, even by its author'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select throws_ok(
  format('select public.remix_library_item(%L, %L)', tests.id('shared_a'), tests.id('unused')),
  '42501', null, 'someone of another board cannot adapt it'
);
select tests.clear_authentication();

-- Without a cap: one's own approved resource, and the board's.
select tests.library_item('own_approved', 'teacher_a', 'worksheet', 'board_approved', 'board', 'school_a1');
select tests.library_item('board_ok', null, 'reading_passage', 'board_approved', 'board');
select tests.growth_pack('pack', 'Ressources IP Lynx');
select tests.library_item('pack_item', null, 'worksheet', 'board_approved', 'board');
update public.library_items set content_pack_id = tests.id('pack') where id = tests.id('pack_item');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.remix_library_item(tests.id('own_approved'), tests.id('own_copy'));
    select public.remix_library_item(tests.id('board_ok'), tests.id('board_copy'));
    select public.remix_library_item(tests.id('pack_item'), tests.id('pack_copy'))$$,
  'a teacher adapts her own approved resource, a board resource and a pack resource'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.library_items
   where id in (tests.id('own_copy'), tests.id('board_copy'), tests.id('pack_copy'))
     and share_cap is null and share_cap_school_id is null and author_id = tests.id('teacher_a')
     and status = 'draft' and share_scope = 'private'),
  3, 'adaptations of her own approved resource and of the board''s have no cap'
);

-- ---------------------------------------------------------------------------------------
-- 3. The credit line (D-092)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select * from public.library_item_lineage(tests.id('copy'))$$,
  $$values (tests.id('shared_a'), 'Ressource shared_a', true, 'author', 'Mme teacher_a', 'É.É.C. A1',
      null::text)$$,
  'the credit names the original''s author and her school for a school resource'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select parent_id, title, available, credit_kind, credit_name, school_name, pack_title
    from public.library_item_lineage(tests.id('board_copy'))
    union all
    select parent_id, title, available, credit_kind, credit_name, school_name, pack_title
    from public.library_item_lineage(tests.id('pack_copy'))$$,
  $$values (tests.id('board_ok'), 'Ressource board_ok', true, 'board', null::text, null::text, null::text),
      (tests.id('pack_item'), 'Ressource pack_item', true, 'pack', null, null, 'Ressources IP Lynx')$$,
  'the board''s own resources credit the board, and a pack''s resources the pack'
);
select is_empty(
  $$select * from public.library_item_lineage(tests.id('shared_a'))$$,
  'an item that is not an adaptation has no credit line'
);
-- The original goes private: the adapter no longer sees who made it.
select lives_ok(
  $$select public.library_share(tests.id('shared_a'), 'private')$$,
  'the author makes her original private again'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select * from public.library_item_lineage(tests.id('copy'))$$,
  $$values (null::uuid, 'Ressource shared_a', false, null::text, null::text, null::text, null::text)$$,
  'an original the reader cannot use shows only the title copied, with no link and no name'
);
select tests.clear_authentication();
delete from public.library_items where id = tests.id('shared_a');
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select parent_id, title, available from public.library_item_lineage(tests.id('copy'))$$,
  $$values (null::uuid, 'Ressource shared_a', false)$$,
  'a deleted original still shows its copied title'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select throws_ok(
  format('select * from public.library_item_lineage(%L)', tests.id('copy')),
  '42501', null, 'the credit line of an item the reader cannot read is refused'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 4. Opinions (D-093)
-- ---------------------------------------------------------------------------------------

select tests.library_item('shared_b', 'teacher_a', 'worksheet', 'teacher_reviewed', 'school', 'school_a1');
select tests.growth_teacher('rater_1');

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.rate_library_item(tests.id('own_approved'), 5::smallint)$$,
  'LXR01', null, 'an author cannot give an opinion on her own resource'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.rate_library_item(tests.id('shared_b'), 5::smallint)$$,
  'LXR02', null, 'a resource that is not board-approved takes no opinion'
);
select is(
  array[tests.error_of('select public.rate_library_item(tests.id(''board_ok''), 0::smallint)'),
        tests.error_of('select public.rate_library_item(tests.id(''board_ok''), 6::smallint)')],
  array['22023', '22023'], 'an opinion is 1 to 5 stars'
);
select throws_ok(
  $$insert into public.library_item_ratings (item_id, rater_id, rating)
    values (tests.id('board_ok'), tests.id('teacher_a_other'), 5)$$,
  '42501', null, 'opinions are never written directly'
);
select lives_ok(
  $$select public.rate_library_item(tests.id('board_ok'), 2::smallint);
    select public.rate_library_item(tests.id('board_ok'), 4::smallint)$$,
  'a teacher gives her opinion and changes it'
);
select results_eq(
  $$select rating, rater_id from public.library_item_ratings where item_id = tests.id('board_ok')$$,
  $$values (4::smallint, tests.id('teacher_a_other'))$$,
  'she sees her own opinion, changed'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select throws_ok(
  $$select public.rate_library_item(tests.id('board_ok'), 4::smallint)$$,
  '42501', null, 'someone of another board cannot give an opinion'
);
select tests.clear_authentication();

select tests.growth_rate('teacher_a', 'board_ok', 4::smallint);
select tests.growth_rate('subject_teacher', 'board_ok', 5::smallint);
select tests.growth_rate('principal_a', 'board_ok', 5::smallint);
select tests.authenticate_as('teacher_a');
select is_empty(
  $$select 1 from public.library_item_ratings where rater_id <> tests.id('teacher_a')$$,
  'nobody sees another person''s opinion'
);
select results_eq(
  $$select item_id, rating_average, rating_count, my_rating, usage_count
    from public.library_item_stats(array[tests.id('board_ok'), tests.id('shared_b'), tests.id('board_draft')])$$,
  $$select * from (values
      (tests.id('board_ok'), null::numeric, 4, 4::smallint, 0),
      (tests.id('shared_b'), null, null, null, 0)) t
    order by 1$$,
  'four opinions give no average yet; a resource not approved has no opinions; unusable items are left out'
);
select tests.clear_authentication();

select tests.growth_rate('rater_1', 'board_ok', 4::smallint);
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select rating_average, rating_count, my_rating
    from public.library_item_stats(array[tests.id('board_ok')])$$,
  $$values (4.5::numeric, 5, 4::smallint)$$,
  'five opinions (4, 4, 5, 5, 4 = 4.4) show 4.5, rounded to the half star'
);
select lives_ok(
  $$select public.rate_library_item(tests.id('board_ok'), null)$$,
  'a teacher takes her opinion back'
);
select results_eq(
  $$select rating_average, rating_count, my_rating
    from public.library_item_stats(array[tests.id('board_ok')])$$,
  $$values (null::numeric, 4, null::smallint)$$,
  'the average waits for a fifth opinion again'
);
select throws_ok(
  format('select * from public.library_item_stats(%L::uuid[])',
    (select array_agg(gen_random_uuid()) from generate_series(1, 51))),
  '22023', null, 'stats are asked for 50 items at most'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select is_empty(
  $$select * from public.library_item_stats(array[tests.id('board_ok')])$$,
  'someone of another board gets no stats for the board''s resources'
);
select tests.clear_authentication();
select is_empty(
  $$select action from public.audit_log
    where action like '%rating%' or action like '%opinion%' or entity_id = tests.id('board_ok')$$,
  'opinions are never audited'
);

-- ---------------------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.library_item_ratings', 'insert')
  and not has_table_privilege('authenticated', 'public.library_item_ratings', 'update')
  and not has_table_privilege('authenticated', 'public.library_item_ratings', 'delete')
  and has_table_privilege('authenticated', 'public.library_item_ratings', 'select'),
  'authenticated only reads opinions (its own, by policy)'
);
select is_empty(
  $$select f from unnest(array['public.remix_library_item(uuid,uuid)', 'public.library_item_lineage(uuid)',
      'public.rate_library_item(uuid,smallint)', 'public.library_item_stats(uuid[])',
      'app.am_library_reviewer(uuid,text)']) f
    where has_function_privilege('anon', f, 'execute')
      or not has_function_privilege('authenticated', f, 'execute')$$,
  'the new functions are for signed-in users only'
);

select * from finish();
rollback;
