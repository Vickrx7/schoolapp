-- Phase 4 library core: saving, the review workflow, reviewers and who sees what
-- (supabase/migrations/20261015090000_library_core.sql; DECISIONS D-063 to D-067, D-079).
begin;
\ir _helpers.psql
select plan(119);
select tests.build_fixture();
select tests.build_library_fixture();

update public.users set honorific = 'Mme' where id = tests.id('teacher_a');
insert into public.language_levels (id, board_id, owner_user_id, code, label_fr)
values (tests.remember('level_personal_other', gen_random_uuid()), tests.id('board_a'),
  tests.id('teacher_a_other'), 'autre_test', 'Autre');
select tests.remember(k, gen_random_uuid())
from unnest(array['draft', 'draft2', 'brain', 'exp', 'personal', 'personal_game', 'faith_item',
  'conn']) k;

-- ---------------------------------------------------------------------------------------
-- 1. Saving
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select results_eq(
  $$select item_id, content_revision from public.save_library_item(tests.id('draft'), null,
    tests.library_payload('worksheet', 'Les castors'))$$,
  $$values (tests.id('draft'), 1)$$,
  'a teacher creates a draft with the id her device picked'
);
select results_eq(
  $$select status::text, share_scope::text, source::text, author_id,
      (select count(*)::int from public.library_item_versions v where v.item_id = i.id)
    from public.library_items i where i.id = tests.id('draft')$$,
  $$values ('draft', 'private', 'teacher_created', tests.id('teacher_a'), 1)$$,
  'the new item is a private draft by its author, with its base version'
);
select results_eq(
  $$select item_id, content_revision from public.save_library_item(tests.id('draft'), null,
    tests.library_payload('worksheet', 'Les castors'))$$,
  $$values (tests.id('draft'), 1)$$,
  'the same create sent again returns the same item and revision'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), null, tests.library_payload('worksheet', 'X'))$$,
  '42501', null, 'another teacher cannot take over the id of an item'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 0, tests.library_payload('worksheet', 'X'))$$,
  'LXL07', null, 'a save from an older revision is refused'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.with_version(tests.library_payload('worksheet', 'X'), null))$$,
  '22023', null, 'an item has exactly one base version'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.with_version(tests.library_payload('worksheet', 'X'), tests.board_level('board_b', 'debutant')))$$,
  '22023', null, 'a version cannot use another board''s level'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.with_version(tests.library_payload('worksheet', 'X'), tests.id('level_personal_other')))$$,
  '22023', null, 'a version cannot use a colleague''s personal level'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.library_payload('worksheet', 'X') || jsonb_build_object('expectationIds',
      jsonb_build_array(tests.id('exp_other'))))$$,
  '22023', null, 'an attente must belong to the item''s subject and grades'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.library_payload('worksheet', 'X') || jsonb_build_object('tagIds', jsonb_build_array(tests.id('tag_b'))))$$,
  '22023', null, 'another board''s tag is refused'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1,
    tests.library_payload('worksheet', 'X') || jsonb_build_object('catholicReferenceId', tests.id('ref_b')))$$,
  '22023', null, 'another board''s Catholic reference is refused'
);
select throws_ok(
  $$select public.save_library_item(tests.id('draft'), 1, tests.library_payload('quiz', 'X'))$$,
  '22023', null, 'an item keeps its type'
);
select throws_ok(
  $$insert into public.library_item_versions (item_id, language_level_id, content)
    values (tests.id('draft'), tests.board_level('board_a', 'debutant'), '{}')$$,
  '42501', null, 'versions cannot be written directly, even by the author'
);
select results_eq(
  $$select item_id, content_revision from public.save_library_item(tests.id('draft'), 1,
    tests.library_payload('worksheet', 'Le castor et le huard'))$$,
  $$values (tests.id('draft'), 2)$$,
  'saving adds one to the revision'
);
select ok(
  (select search_document @@ to_tsquery('app.french_unaccent', 'castor & huard & idee & etiquette')
   from public.library_items where id = tests.id('draft')),
  'the search document follows the new title, the content and the tags, without accents'
);

-- ---------------------------------------------------------------------------------------
-- 2. Marking reviewed (« J'ai révisé cette ressource »)
-- ---------------------------------------------------------------------------------------

select public.save_library_item(tests.id('draft'), 2,
  tests.library_payload('worksheet', 'Le castor et le huard') - 'expectationIds');
select is(
  tests.error_of($$select public.library_mark_reviewed(tests.id('draft'), true)$$),
  'LXL01 expectations',
  'an item without an attente cannot be marked reviewed, and the reason is given'
);
select public.save_library_item(tests.id('draft'), 3, tests.library_payload('worksheet', 'Le castor et le huard'));
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('draft'), true)$$,
  'once an attente is linked, the author marks it reviewed'
);
select public.save_library_item(tests.id('brain'), null,
  tests.library_payload('brain_break', 'Le miroir') || '{"expectationIds": []}');
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('brain'), true)$$,
  'a pause active needs no attente'
);
select public.save_library_item(tests.id('draft2'), null, tests.library_payload('worksheet', 'Brouillon'));
select throws_ok(
  $$select public.library_mark_reviewed(tests.id('draft2'), false)$$,
  '22023', null, 'the originality confirmation is required'
);
select public.save_library_item(tests.id('exp'), null, tests.library_payload('experiment', 'Éponges'));
select is(
  tests.error_of($$select public.library_mark_reviewed(tests.id('exp'), true)$$),
  'LXL02', 'an experiment without safety notes cannot be marked reviewed'
);
select public.save_library_item(tests.id('exp'), 1, tests.library_payload('experiment', 'Éponges')
  || jsonb_build_object('safetyNotes', tests.safety_notes() || '{"allergyAwareMaterials": "  "}'));
select is(
  tests.error_of($$select public.library_mark_reviewed(tests.id('exp'), true)$$),
  'LXL02', 'incomplete safety notes are not enough'
);
select public.save_library_item(tests.id('exp'), 2, tests.library_payload('experiment', 'Éponges')
  || jsonb_build_object('safetyNotes', tests.safety_notes('close')));
select lives_ok(
  $$select public.library_mark_reviewed(tests.id('exp'), true)$$,
  'with complete safety notes, the experiment is marked reviewed'
);
select throws_ok(
  $$select public.save_library_item(tests.id('exp'), 3, tests.library_payload('experiment', 'Éponges')
    || jsonb_build_object('safetyNotes', tests.safety_notes('close'), 'subFriendly', true))$$,
  '22023', null, 'an experiment under close supervision cannot be for substitutes'
);
select is(
  tests.error_of($$select public.save_library_item(tests.id('draft'), 4,
    tests.library_payload('worksheet', 'Le castor et le huard') || '{"materials": ""}')$$),
  'LXL01 materials',
  'a reviewed item cannot be saved incomplete'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.library_mark_reviewed(tests.id('draft2'), true)$$,
  '42501', null, 'a colleague cannot mark someone else''s item reviewed'
);
select tests.clear_authentication();

select is(
  (select details from public.audit_log where action = 'library_item.reviewed'
   and entity_id = tests.id('draft')),
  '{"revision": 4, "originality_confirmed": true}'::jsonb,
  'marking reviewed is audited with the originality confirmation'
);

-- ---------------------------------------------------------------------------------------
-- 3. Sharing
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.library_share(tests.id('draft'), 'school', tests.id('school_a1'))$$,
  'the author shares a reviewed item with her school'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.library_items where id = tests.id('draft')), 1,
  'a colleague at the school can use it');
select tests.clear_authentication();
select tests.authenticate_as('principal_a2');
select is((select count(*)::int from public.library_items where id = tests.id('draft')), 0,
  'staff of another school of the board cannot');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.library_share(tests.id('draft'), 'board', null, 2)$$,
  'the author shares it with the whole board'
);
select tests.clear_authentication();
select tests.authenticate_as('principal_a2');
select is((select count(*)::int from public.library_items where id = tests.id('draft')), 1,
  'every school of the board can use it now');
select tests.clear_authentication();
select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.library_items where id = tests.id('draft')), 0,
  'another board never sees it');
select tests.clear_authentication();

select results_eq(
  $$select payload from public.event_outbox
    where event_type = 'library_item.shared' and aggregate_id = tests.id('draft') order by id$$,
  $$values (jsonb_build_object('itemId', tests.id('draft'), 'scope', 'school')),
           (jsonb_build_object('itemId', tests.id('draft'), 'scope', 'board'))$$,
  'sharing emits library_item.shared with the item id and scope only'
);
select is(
  (select details from public.audit_log where action = 'library_item.shared'
   and entity_id = tests.id('draft') order by id desc limit 1),
  '{"scope": "board", "names_confirmed": 2}'::jsonb,
  'sharing is audited with the number of names the author confirmed'
);

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.library_share(tests.id('draft2'), 'school', tests.id('school_a1'))$$,
  'LXL04', null, 'a draft cannot be shared'
);
select throws_ok(
  $$select public.library_share(tests.id('draft'), 'school', tests.id('school_b1'))$$,
  '42501', null, 'an item cannot be shared into a school where the author does not work'
);
select is(
  tests.error_of($$select public.save_library_item(tests.id('draft'), 4,
    tests.with_version(tests.library_payload('worksheet', 'Le castor et le huard'),
      tests.id('level_personal_a')))$$),
  'LXL10',
  'a shared item cannot get a version for a personal level'
);
select public.save_library_item(tests.id('personal'), null,
  tests.with_version(tests.library_payload('worksheet', 'Pour mon groupe'), tests.id('level_personal_a')));
select public.library_mark_reviewed(tests.id('personal'), true);
select throws_ok(
  $$select public.library_share(tests.id('personal'), 'school', tests.id('school_a1'))$$,
  'LXL10', null, 'an item with a version for a personal level stays private'
);
select public.save_library_item(tests.id('personal_game'), null,
  tests.with_version(tests.library_payload('game', 'Jeu du groupe'), tests.id('level_personal_a')));
select public.library_mark_reviewed(tests.id('personal_game'), true);
select throws_ok(
  $$select public.library_request_approval(tests.id('personal_game'))$$,
  'LXL10', null, 'nor can it be proposed to the board'
);
select public.save_library_item(tests.id('faith_item'), null,
  tests.library_payload('game', 'Jeu de la prière') || '{"faithContent": true}');
select public.library_mark_reviewed(tests.id('faith_item'), true);
select throws_ok(
  $$select public.library_share(tests.id('faith_item'), 'board')$$,
  'LXL03', null, 'faith content reaches the whole board only after its faith review'
);
select lives_ok(
  $$select public.library_share(tests.id('faith_item'), 'school', tests.id('school_a1'))$$,
  'faith content can be shared with the school (the teacher''s authority)'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 4. Who sees what (D-065)
-- ---------------------------------------------------------------------------------------

select tests.library_item('other_draft', 'teacher_a_other', 'worksheet');
select tests.library_item('quiz_req', 'teacher_a_other', 'quiz', 'teacher_reviewed');
select tests.library_item('faith_req', 'teacher_a_other', 'catholic_reflection', 'teacher_reviewed');
select tests.library_item('b_req', 'teacher_b', 'worksheet', 'teacher_reviewed', 'private', null, 'board_b');
select tests.library_item('shared_a1', 'teacher_a_other', 'worksheet', 'teacher_reviewed', 'school', 'school_a1');
select tests.library_request('faith_req');
select tests.library_request('b_req');

select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.library_items where id = tests.id('other_draft')), 0,
  'a board admin no longer sees teachers'' private drafts');
select is((select count(*)::int from public.library_items where id = tests.id('quiz_req')), 0,
  'a content reviewer does not see a private item nobody proposed');
select tests.clear_authentication();
select tests.library_request('quiz_req');
select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('quiz_req')),
      (select count(*)::int from public.library_item_answer_keys k
       join public.library_item_versions v on v.id = k.version_id where v.item_id = tests.id('quiz_req'))$$,
  $$values (1, 5)$$,
  'once proposed, the content reviewer sees the item and its answer keys'
);
select is((select count(*)::int from public.library_items where id = tests.id('b_req')), 0,
  'another board''s requests stay invisible');
select is((select count(*)::int from public.library_items where id = tests.id('shared_a1')), 1,
  'the content reviewer sees items shared with a school of the board');
select tests.clear_authentication();

select tests.authenticate_as('faith_reviewer_a');
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('quiz_req')),
      (select count(*)::int from public.library_items where id = tests.id('faith_req'))$$,
  $$values (0, 1)$$,
  'the faith reviewer sees only requested items that need a faith review'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 5. Approval
-- ---------------------------------------------------------------------------------------

select tests.library_item('admin_item', 'board_admin_a', 'worksheet', 'teacher_reviewed');
select tests.library_request('admin_item');
select tests.library_item('passage', 'teacher_a_other', 'reading_passage', 'teacher_reviewed');
delete from public.library_item_versions
where item_id = tests.id('passage') and language_level_id = tests.board_level('board_a', 'enrichi');
select tests.library_request('passage');

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.library_decide(tests.id('quiz_req'), 'approve', null, 1)$$,
  '42501', null, 'an author who is not a reviewer cannot approve'
);
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.library_decide(tests.id('admin_item'), 'approve', null, 1)$$,
  'LXL05', null, 'a reviewer cannot approve their own item'
);
select throws_ok(
  $$select public.library_decide(tests.id('quiz_req'), 'approve', null, 7)$$,
  'LXL07', null, 'an item that changed since the reviewer opened it is not approved'
);
select is(
  tests.error_of($$select public.library_decide(tests.id('passage'), 'approve', null, 1)$$),
  'LXL01 levels',
  'a reading passage needs a version for every board level to be approved'
);
select lives_ok(
  $$select public.library_decide(tests.id('quiz_req'), 'approve', 'Très bien.', 1)$$,
  'the content reviewer approves a colleague''s quiz'
);
select tests.clear_authentication();

select results_eq(
  $$select status::text, share_scope::text, approved_by, approved_at is not null,
      review_requested_at is null
    from public.library_items where id = tests.id('quiz_req')$$,
  $$values ('board_approved', 'board', tests.id('board_admin_a'), true, true)$$,
  'an approved item is shared with the board and records who approved it'
);
select results_eq(
  $$select payload from public.event_outbox
    where event_type = 'library_item.approved' and aggregate_id = tests.id('quiz_req')$$,
  $$values (jsonb_build_object('itemId', tests.id('quiz_req')))$$,
  'approval emits library_item.approved with the item id only'
);
select is(
  (select details from public.audit_log where action = 'library_item.approved'
   and entity_id = tests.id('quiz_req')),
  '{"type": "quiz", "revision": 1, "faith_reviewed": false}'::jsonb,
  'approval is audited without the note'
);

select tests.authenticate_as('principal_a2');
select is((select count(*)::int from public.library_items where id = tests.id('quiz_req')), 1,
  'an approved item is usable across the board');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.save_library_item(tests.id('quiz_req'), 1, tests.library_payload('quiz', 'Quiz'))$$,
  'LXL06', null, 'an approved item is read-only, even for its author'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 6. Faith review (D-064)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('conn'), null,
  tests.library_payload('worksheet', 'Prendre soin') || jsonb_build_object(
    'catholicConnection', 'Prenons soin de la création.', 'catholicReferenceId', tests.id('ref_a')));
select tests.clear_authentication();
select results_eq(
  $$select id, requires_faith_review from public.library_items
    where id in (tests.id('conn'), tests.id('faith_item'), tests.id('draft')) order by title$$,
  $$values (tests.id('faith_item'), true), (tests.id('draft'), false), (tests.id('conn'), true)$$,
  'a faith link or the faith content box makes a faith review necessary'
);

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.library_decide(tests.id('faith_req'), 'approve', null, 1)$$,
  'LXL03', null, 'faith content is not approved before its faith review'
);
select throws_ok(
  $$select public.library_faith_decide(tests.id('faith_req'), 'approve', null, 1)$$,
  '42501', null, 'a content reviewer does not do faith reviews'
);
select tests.clear_authentication();
select tests.authenticate_as('faith_reviewer_a');
select lives_ok(
  $$select public.library_faith_decide(tests.id('faith_req'), 'approve', null, 1)$$,
  'the faith reviewer approves the faith content'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select lives_ok(
  $$select public.library_decide(tests.id('faith_req'), 'approve', null, 1)$$,
  'then the content reviewer approves it for the board'
);
select lives_ok(
  $$select public.library_flag_faith(tests.id('draft'))$$,
  'a reviewer flags faith content the author did not tick'
);
select tests.clear_authentication();
select results_eq(
  $$select share_scope::text, faith_content, faith_flagged_by, requires_faith_review
    from public.library_items where id = tests.id('draft')$$,
  $$values ('school', true, tests.id('board_admin_a'), true)$$,
  'flagged, the board-shared item goes back to its school until a faith review'
);
select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('draft'), 4, tests.library_payload('worksheet', 'Le castor et le huard'));
select tests.clear_authentication();
select is((select faith_content from public.library_items where id = tests.id('draft')), true,
  'the author cannot clear a reviewer''s faith flag by saving');

-- ---------------------------------------------------------------------------------------
-- 7. Edits reset the review state (D-063)
-- ---------------------------------------------------------------------------------------

select tests.library_item('edit_req', 'teacher_a', 'game', 'teacher_reviewed');
update public.library_items set catholic_connection = 'Jouons ensemble dans la paix.'
where id = tests.id('edit_req');
select tests.library_request('edit_req');
select tests.authenticate_as('faith_reviewer_a');
select public.library_faith_decide(tests.id('edit_req'), 'approve', null, 1);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.library_review_queue('content') where item_id = tests.id('edit_req')), 1,
  'the proposed item is in the content queue');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('edit_req'), 1, tests.library_payload('game', 'Ressource edit_req')
  || '{"catholicConnection": "Jouons ensemble dans la paix."}');
select tests.clear_authentication();
select results_eq(
  $$select review_requested_at is null, faith_reviewed_at is null, content_revision
    from public.library_items where id = tests.id('edit_req')$$,
  $$values (true, true, 2)$$,
  'an edit clears the request and the faith review and adds a revision'
);
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.library_review_queue('content') where item_id = tests.id('edit_req')), 0,
  'the edited item leaves the queue until proposed again');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 8. Sending back and withdrawing
-- ---------------------------------------------------------------------------------------

select tests.library_item('rej', 'teacher_a_other', 'worksheet', 'teacher_reviewed', 'school', 'school_a1');
select tests.library_request('rej');
select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.library_decide(tests.id('rej'), 'reject', '  ', 1)$$,
  '22023', null, 'sending back needs a note'
);
select lives_ok(
  $$select public.library_decide(tests.id('rej'), 'reject', 'Ajoutez une question sur le texte.', 1)$$,
  'the reviewer sends the item back with a note'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.library_items where id = tests.id('rej')), 0,
  'sent back, the item leaves colleagues'' libraries');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select status::text, share_scope::text, review_note from public.library_items where id = tests.id('rej')$$,
  $$values ('rejected', 'private', 'Ajoutez une question sur le texte.')$$,
  'its author finds it « À retravailler » with the reviewer''s note'
);
select lives_ok(
  $$select public.save_library_item(tests.id('rej'), 1, tests.library_payload('worksheet', 'Ressource rej'));
    select public.library_mark_reviewed(tests.id('rej'), true)$$,
  'the author edits it and marks it reviewed again'
);
select is((select review_note from public.library_items where id = tests.id('rej')), null,
  'marking it reviewed again clears the note');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.library_retract(tests.id('quiz_req'), null)$$,
  '22023', null, 'withdrawing an item needs a note'
);
select lives_ok(
  $$select public.library_retract(tests.id('quiz_req'), 'La question 3 a deux bonnes réponses.')$$,
  'a content reviewer withdraws an approved item'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.library_items where id = tests.id('quiz_req')), 0,
  'the withdrawn item leaves colleagues'' libraries');
select tests.clear_authentication();
select results_eq(
  $$select status::text, share_scope::text, approved_at is null,
      (select count(*)::int from public.audit_log a
       where a.action = 'library_item.retracted' and a.entity_id = i.id),
      (select count(*)::int from public.event_outbox e
       where e.event_type = 'library_item.retracted' and e.aggregate_id = i.id
         and e.payload = jsonb_build_object('itemId', i.id))
    from public.library_items i where i.id = tests.id('quiz_req')$$,
  $$values ('rejected', 'private', true, 1, 1)$$,
  'withdrawing is audited and emitted, and the item loses its approval'
);

-- ---------------------------------------------------------------------------------------
-- 9. Archiving and restoring
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a_other');
select throws_ok(
  $$select public.library_archive(tests.id('faith_item'))$$,
  '42501', null, 'only the author archives an item'
);
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.library_archive(tests.id('faith_item'))$$,
  'the author archives a shared item'
);
select results_eq(
  $$select status::text, share_scope::text from public.library_items where id = tests.id('faith_item')$$,
  $$values ('archived', 'private')$$,
  'an archived item is private'
);
select throws_ok(
  $$select public.library_archive(tests.id('faith_item'))$$,
  'LXL04', null, 'an archived item cannot be archived again'
);
select lives_ok(
  $$select public.library_restore(tests.id('faith_item'))$$,
  'the author restores it'
);
select is((select status::text from public.library_items where id = tests.id('faith_item')), 'draft',
  'a restored item is a draft');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 10. The board's own items (no author) are kept by its content reviewers
-- ---------------------------------------------------------------------------------------

select tests.library_item('board_item', null, 'worksheet');
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select (select count(*)::int from public.library_items where id = tests.id('board_item')),
      tests.error_of($q$select public.save_library_item(tests.id('board_item'), 1,
        tests.library_payload('worksheet', 'Fiche du conseil'))$q$)$$,
  $$values (0, '42501')$$,
  'a teacher can neither see nor edit a board item in preparation'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select lives_ok(
  $$select public.save_library_item(tests.id('board_item'), 1,
      tests.with_board_levels(tests.library_payload('worksheet', 'Fiche du conseil')));
    select public.library_mark_reviewed(tests.id('board_item'), true);
    select public.library_request_approval(tests.id('board_item'));
    select public.library_decide(tests.id('board_item'), 'approve', null, 2)$$,
  'a content reviewer edits, marks reviewed, proposes and approves a board item'
);
select tests.clear_authentication();
select results_eq(
  $$select status::text, author_id, approved_by,
      (select count(*)::int from public.event_outbox e
       where e.event_type = 'library_item.review_requested' and e.aggregate_id = i.id
         and e.payload = jsonb_build_object('itemId', i.id))
    from public.library_items i where i.id = tests.id('board_item')$$,
  $$values ('board_approved', null::uuid, tests.id('board_admin_a'), 1)$$,
  'the board item is approved, still without an author; the request was emitted'
);

-- ---------------------------------------------------------------------------------------
-- 11. Deactivated users, parents and outsiders
-- ---------------------------------------------------------------------------------------

select tests.library_item('former_item', 'former_teacher', 'worksheet', 'teacher_reviewed');
select tests.authenticate_as('former_teacher');
select is(
  array(select coalesce(left(tests.error_of(s), 5), 'ok') from unnest(array[
    format('select public.save_library_item(%L, null, tests.library_payload(''worksheet'', ''X''))', gen_random_uuid()),
    'select public.save_library_item(tests.id(''former_item''), 1, tests.library_payload(''worksheet'', ''X''))',
    'select public.library_mark_reviewed(tests.id(''former_item''), true)',
    'select public.library_return_to_draft(tests.id(''former_item''))',
    'select public.library_share(tests.id(''former_item''), ''school'', tests.id(''school_a1''))',
    'select public.library_request_approval(tests.id(''former_item''))',
    'select public.library_cancel_request(tests.id(''former_item''))',
    'select public.library_decide(tests.id(''former_item''), ''approve'', null, 1)',
    'select public.library_faith_decide(tests.id(''former_item''), ''approve'', null, 1)',
    'select public.library_flag_faith(tests.id(''former_item''))',
    'select public.library_retract(tests.id(''former_item''), ''Note'')',
    'select public.library_archive(tests.id(''former_item''))',
    'select public.library_restore(tests.id(''former_item''))',
    'select public.library_review_queue(''content'')',
    'select public.add_library_item_to_unit(tests.id(''former_item''), tests.id(''unit_a''), null, ''{"title": "X"}'')'
  ]) s),
  array_fill('42501'::text, array[15]),
  'a deactivated user is refused by every library function'
);
select tests.clear_authentication();

select tests.create_user('parent_a');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('parent_a'), 'parent', tests.id('board_a'), tests.id('school_a1'));
select throws_ok(
  $$insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('parent_a'))$$,
  '22023', null, 'a parent cannot be designated as a reviewer'
);
select throws_ok(
  $$insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('former_teacher'))$$,
  '22023', null, 'a deactivated user cannot be designated as a reviewer'
);
select throws_ok(
  $$insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('teacher_b'))$$,
  '22023', null, 'staff of another board cannot be designated'
);

select tests.authenticate_as('parent_a');
select is((select count(*)::int from public.library_items where id = tests.id('board_item')), 0,
  'a parent cannot read board-approved items');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 12. Designations (D-064, D-079)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('faith_reviewer_a');
select results_eq(
  $$select user_id, approves_content, reviews_faith from public.library_reviewers$$,
  $$values (tests.id('faith_reviewer_a'), false, true)$$,
  'a reviewer sees their own designation only'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.library_reviewers where board_id = tests.id('board_a')), 2,
  'the board admin sees the board''s designations');
select tests.clear_authentication();
select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.library_reviewers), 0, 'a teacher sees no designations');
select throws_ok(
  $$insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('teacher_a'))$$,
  '42501', null, 'nobody designates reviewers through the API'
);
select tests.clear_authentication();

insert into public.library_reviewers (board_id, user_id) values (tests.id('board_a'), tests.id('teacher_a_other'));
update public.library_reviewers set reviews_faith = true
where board_id = tests.id('board_a') and user_id = tests.id('teacher_a_other');
delete from public.library_reviewers
where board_id = tests.id('board_a') and user_id = tests.id('teacher_a_other');
select results_eq(
  $$select action, details from public.audit_log
    where entity_type = 'user' and entity_id = tests.id('teacher_a_other') and action like 'library_reviewer.%'
    order by id$$,
  $$values ('library_reviewer.designated', '{"approves_content": true, "reviews_faith": false}'::jsonb),
           ('library_reviewer.changed', '{"approves_content": true, "reviews_faith": true}'::jsonb),
           ('library_reviewer.removed', '{"approves_content": true, "reviews_faith": true}'::jsonb)$$,
  'designating, changing and removing a reviewer are audited'
);
select ok(
  not app.library_reviewer(tests.id('teacher_a_other'), tests.id('board_a'), 'content')
  and app.library_reviewer(tests.id('board_admin_a'), tests.id('board_a'), 'content')
  and not app.library_reviewer(tests.id('board_admin_a'), tests.id('board_a'), 'faith')
  and not app.library_reviewer(tests.id('board_admin_a'), tests.id('board_b'), 'content'),
  'app.library_reviewer answers per board and per kind'
);

-- ---------------------------------------------------------------------------------------
-- 13. The approval queues
-- ---------------------------------------------------------------------------------------

select tests.library_item('q_plain', 'teacher_a', 'worksheet', 'teacher_reviewed', 'private', 'school_a1');
select tests.library_item('q_faith', 'teacher_a', 'catholic_reflection', 'teacher_reviewed');
select tests.library_item('q_faith_done', 'teacher_a', 'catholic_reflection', 'teacher_reviewed');
select tests.library_request(k) from unnest(array['q_plain', 'q_faith', 'q_faith_done']) k;
update public.library_items set faith_reviewed_at = now(), faith_reviewed_by = tests.id('faith_reviewer_a')
where id = tests.id('q_faith_done');

select tests.authenticate_as('faith_reviewer_a');
select results_eq(
  $$select item_id from public.library_review_queue('faith')
    where item_id in (tests.id('q_plain'), tests.id('q_faith'), tests.id('q_faith_done'))$$,
  $$values (tests.id('q_faith'))$$,
  'the faith queue lists only faith content not yet faith-reviewed'
);
select throws_ok(
  $$select * from public.library_review_queue('content')$$,
  '42501', null, 'a faith reviewer has no content queue'
);
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select results_eq(
  $$select author_name, school_name, grade_codes, requires_faith_review, faith_reviewed
    from public.library_review_queue('content') where item_id = tests.id('q_plain')$$,
  $$values ('Mme teacher_a', 'School A1', array['3'], false, false)$$,
  'the content queue names the author formally, with the school and grades'
);
select results_eq(
  $$select author_name from public.library_review_queue('content')
    where item_id = tests.id('q_faith_done')$$,
  $$values ('Mme teacher_a')$$,
  'faith-reviewed items wait in the content queue'
);
select throws_ok(
  $$select * from public.library_review_queue('other')$$,
  '22023', null, 'there are two queues'
);
select tests.clear_authentication();

select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select * from public.library_review_queue('content')$$,
  '42501', null, 'teachers have no approval queue'
);
select lives_ok(
  $$select public.library_cancel_request(tests.id('q_plain'))$$,
  'the author withdraws her request'
);
select tests.clear_authentication();
select results_eq(
  $$select review_requested_at is null,
      (select count(*)::int from public.audit_log a
       where a.action = 'library_item.review_cancelled' and a.entity_id = i.id)
    from public.library_items i where i.id = tests.id('q_plain')$$,
  $$values (true, 1)$$,
  'withdrawing the request is audited'
);

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.library_return_to_draft(tests.id('brain'))$$,
  'the author returns a reviewed item to draft'
);
select tests.clear_authentication();
select results_eq(
  $$select status::text, share_scope::text,
      (select count(*)::int from public.audit_log a
       where a.action = 'library_item.returned_to_draft' and a.entity_id = i.id)
    from public.library_items i where i.id = tests.id('brain')$$,
  $$values ('draft', 'private', 1)$$,
  'a draft again, private, and audited'
);

-- ---------------------------------------------------------------------------------------
-- 14. Review fixes (20261015090400_library_review_fixes.sql): an edit that needs a faith
--     review takes an item off the whole board (D-064); authors who left the board no longer
--     edit it, propose it or widen its sharing (D-065)
-- ---------------------------------------------------------------------------------------

-- An item shared with the whole board gains faith content when its author saves it.
select tests.library_item('board_game', 'teacher_a', 'game', 'teacher_reviewed', 'board', 'school_a1');
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select content_revision from public.save_library_item(tests.id('board_game'), 1,
    tests.library_payload('game', 'Ressource board_game')
    || '{"faithContent": true, "catholicConnection": "Jouer ensemble dans le respect."}')$$,
  $$values (2)$$,
  'the author adds faith content to an item shared with the whole board'
);
select tests.clear_authentication();
select results_eq(
  $$select status::text, share_scope::text, requires_faith_review, faith_reviewed_at is null,
      (select count(*)::int from public.audit_log a
       where a.action = 'library_item.scope_reduced' and a.entity_id = i.id
         and a.details = '{"scope": "school", "reason": "faith_review"}'::jsonb)
    from public.library_items i where i.id = tests.id('board_game')$$,
  $$values ('teacher_reviewed', 'school', true, true, 1)$$,
  'it goes back to its school until its faith review, and that is audited'
);

-- A faith-reviewed item shared with the whole board (no school): any edit ends the faith review.
select tests.library_item('board_faith', 'teacher_a', 'game', 'teacher_reviewed', 'board');
update public.library_items
set faith_content = true, faith_reviewed_at = now(), faith_reviewed_by = tests.id('faith_reviewer_a')
where id = tests.id('board_faith');
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.save_library_item(tests.id('board_faith'), 1,
    tests.library_payload('game', 'Ressource board_faith modifiée') || '{"faithContent": true}')$$,
  'the author edits a faith-reviewed item shared with the whole board'
);
select tests.clear_authentication();
select results_eq(
  $$select share_scope::text, faith_reviewed_at is null
    from public.library_items where id = tests.id('board_faith')$$,
  $$values ('private', true)$$,
  'the earlier faith review no longer counts: without a school, it becomes private'
);

-- Without faith content, an edit keeps the whole board.
select tests.library_item('board_plain', 'teacher_a', 'game', 'teacher_reviewed', 'board', 'school_a1');
select tests.authenticate_as('teacher_a');
select public.save_library_item(tests.id('board_plain'), 1,
  tests.library_payload('game', 'Ressource board_plain modifiée'));
select tests.clear_authentication();
select is(
  (select share_scope::text from public.library_items where id = tests.id('board_plain')), 'board',
  'an edit without faith content keeps its sharing'
);

-- An author who lost every role in the board (her account still active).
select tests.create_user('leaver');
insert into public.user_roles (user_id, role, board_id, school_id)
values (tests.id('leaver'), 'teacher', tests.id('board_a'), tests.id('school_a1'));
select tests.library_item('left_item', 'leaver', 'game', 'teacher_reviewed', 'school', 'school_a1');
delete from public.user_roles where user_id = tests.id('leaver');
select tests.authenticate_as('leaver');
select throws_ok(
  $$select public.save_library_item(tests.id('left_item'), 1,
    tests.library_payload('game', 'Modifiée après son départ'))$$,
  '42501', null, 'an author who left the board no longer edits her item'
);
select throws_ok(
  $$select public.library_share(tests.id('left_item'), 'board')$$,
  '42501', null, 'nor shares it more widely'
);
select throws_ok(
  $$select public.library_request_approval(tests.id('left_item'))$$,
  '42501', null, 'nor proposes it to the board'
);
select lives_ok(
  $$select public.library_share(tests.id('left_item'), 'private')$$,
  'she can still make it private'
);
select is(
  (select count(*)::int from public.library_items where id = tests.id('left_item')), 1,
  'and still reads it'
);
select tests.clear_authentication();

-- Audit details and event payloads never hold notes, titles or names.
select is_empty(
  $$select id from public.audit_log
    where action like 'library_item.%'
      and (details::text ~ '(Ajoutez|question 3|Très bien|Ressource|castor|teacher_a)')
    union all
    select id from public.event_outbox
    where event_type like 'library_item.%' and payload - 'itemId' - 'scope' <> '{}'::jsonb$$,
  'library audit entries and events hold ids and flags only'
);

select * from finish();
rollback;
