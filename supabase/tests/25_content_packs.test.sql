-- Phase 5 content packs, format v1: who may call the functions, what an export holds, staging,
-- the dry run, applying into the board's review queue, approval by a named reviewer, later
-- versions, discarding and the clean-up
-- (supabase/migrations/20261101090400_content_packs.sql; DECISIONS D-099, D-100, D-101).
begin;
\ir _helpers.psql
select plan(69);
select tests.build_fixture();
select tests.build_library_fixture();
\ir _content_packs_helpers.psql

-- ---------------------------------------------------------------------------------------
-- 1. The operator only
-- ---------------------------------------------------------------------------------------

select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon', 'authenticated']) r (rolname)
    where n.nspname in ('public', 'app') and p.proname like 'content\_pack\_%'
      and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  'API roles cannot execute any content pack function'
);
select set_eq(
  $$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'content\_pack\_%'
      and has_function_privilege('service_role', p.oid, 'execute')$$,
  $$values ('content_pack_export_items(uuid,jsonb,uuid,integer)'),
      ('content_pack_stage(uuid,jsonb,text)'), ('content_pack_stage_items(uuid,jsonb,text[])'),
      ('content_pack_preview(uuid,jsonb)'), ('content_pack_apply(uuid,jsonb)'),
      ('content_pack_discard(uuid)'), ('content_pack_list(uuid)'), ('content_pack_people(uuid)'),
      ('content_pack_record_export(uuid,text,text,integer,text)')$$,
  'the operator (service role) runs the content pack functions'
);
select is_empty(
  $$select t.tbl || ' ' || p.priv
    from unnest(array['public.content_pack_imports', 'public.content_pack_import_items']) t (tbl)
    cross join unnest(array['select', 'insert', 'update', 'delete']) p (priv)
    cross join unnest(array['anon', 'authenticated']) r (rolname)
    where has_table_privilege(r.rolname, t.tbl, p.priv)
      or (p.priv <> 'delete' and has_any_column_privilege(r.rolname, t.tbl, p.priv))$$,
  'API roles cannot touch staged imports'
);

select tests.authenticate_as('board_admin_a');
select throws_ok(
  $$select public.content_pack_list(tests.id('board_a'))$$,
  '42501', null, 'a board''s content reviewer cannot list its packs through the API'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 2. Export (D-099)
-- ---------------------------------------------------------------------------------------

-- Board A: its own approved items (one from a pack of its own publisher), another publisher's
-- pack item, a teacher's approved item, and items that are never exported.
insert into public.content_packs (id, board_id, slug, version, title, publisher) values
  (tests.remember('own_pack', gen_random_uuid()), tests.id('board_a'), 'propre', '2026.1',
   'Nos ressources', 'IP Lynx'),
  (tests.remember('other_pack', gen_random_uuid()), tests.id('board_a'), 'autre', '2026.1',
   'Ressources d''ailleurs', 'Autre éditeur');
select tests.library_item('x_board', null, 'quiz', 'board_approved', 'board');
select tests.library_item('x_own_pack', null, 'song', 'board_approved', 'board');
update public.library_items
set content_pack_id = tests.id('own_pack'), pack_slug = 'propre', pack_item_key = 'chanson-propre'
where id = tests.id('x_own_pack');
select tests.library_item('x_other_pack', null, 'song', 'board_approved', 'board');
update public.library_items
set content_pack_id = tests.id('other_pack'), pack_slug = 'autre', pack_item_key = 'chanson-autre'
where id = tests.id('x_other_pack');
select tests.library_item('x_teacher', 'teacher_a', 'brain_break', 'board_approved', 'board',
  'school_a1');
select tests.library_item('x_shared', 'teacher_a', 'song', 'teacher_reviewed', 'board', 'school_a1');
select tests.library_item('x_draft', null, 'song');
select tests.library_item('x_archived', null, 'song', 'archived');
select tests.library_item('x_board_b', null, 'song', 'board_approved', 'board', null, 'board_b');
-- A version for teacher_a's personal level on the board's quiz (the workflow refuses it; the
-- export must leave it out anyway), and a tag.
insert into public.library_item_versions (item_id, language_level_id, content)
values (tests.id('x_board'), tests.id('level_personal_a'),
  '{"title": "", "objective": "", "teacherNote": "", "text": "Version personnelle"}');
insert into public.library_item_tags (item_id, tag_id) values (tests.id('x_board'), tests.id('tag_global'));

-- Export keys, by id: the item's id, or its key when the pack is exported again under its slug.
create function tests.export_keys(p_filters jsonb)
returns setof text
language sql
as $$
  select x ->> 'key'
  from jsonb_array_elements(
    public.content_pack_export_items(tests.id('board_a'), p_filters, null, 100) -> 'items') x;
$$;
grant execute on function tests.export_keys(jsonb) to service_role;

select set_config('role', 'service_role', true);
select set_eq(
  $$select * from tests.export_keys('{"slug": "export-test", "publisher": "IP Lynx"}')$$,
  $$values (tests.id('x_board')::text), (tests.id('x_own_pack')::text)$$,
  'by default: the board''s own approved items, from its own publisher''s packs too'
);
select set_eq(
  $$select * from tests.export_keys('{"slug": "propre", "publisher": "ip lynx"}')$$,
  $$values (tests.id('x_board')::text), ('chanson-propre')$$,
  'exported again under its slug, a pack item keeps its key (the publisher matches without case)'
);
select set_eq(
  $$select * from tests.export_keys('{"slug": "export-test", "publisher": "IP Lynx",
      "includeTeacherItems": true, "includePackItems": true}')$$,
  $$values (tests.id('x_board')::text), (tests.id('x_own_pack')::text),
      (tests.id('x_other_pack')::text), (tests.id('x_teacher')::text)$$,
  'teachers'' approved items and other publishers'' pack items only when asked; never drafts, shared-only, archived or other boards'' items'
);
select is(
  (select count(*)::int from tests.export_keys('{"slug": "export-test", "gradeCodes": ["5"]}'))
  + (select count(*)::int from tests.export_keys('{"slug": "export-test", "subjectCodes": ["mat"]}')),
  0, 'the grade and subject filters narrow the export'
);
select is(
  (select x from jsonb_array_elements(public.content_pack_export_items(tests.id('board_a'),
     '{"slug": "export-test"}', null, 100) -> 'items') x where x ->> 'key' = tests.id('x_board')::text)
    - 'versions' - 'key' - 'title',
  jsonb_build_object('type', 'quiz', 'summary', null, 'gradeCodes', jsonb_build_array('3'),
    'subjectCode', 'fra', 'expectations', jsonb_build_array(jsonb_build_object(
      'curriculumVersion', 'test', 'gradeCode', '3', 'code', 'T1.2')),
    'durationMinutes', 30, 'materials', 'Crayons et feuilles', 'keywords', 'lecture',
    'formats', jsonb_build_object('printable', true, 'projectable', false, 'interactive', false),
    'safetyNotes', null,
    'faith', jsonb_build_object('faithContent', false, 'catholicConnection', null, 'reference', null,
      'onStudentSheet', false),
    'tags', jsonb_build_array(jsonb_build_object('slug',
      (select slug from public.tags where id = tests.id('tag_global')), 'label', 'Étiquette de test')),
    'licence', null, 'noDerivatives', false,
    'provenance', jsonb_build_object('source', 'board_created', 'promptVersion', null, 'model', null)),
  'an exported item names its subject, grades, attentes (with their curriculum version) and tags by code'
);
select results_eq(
  $$select v ->> 'level', v -> 'answerKey' is not null
    from jsonb_array_elements((select x -> 'versions' from jsonb_array_elements(
      public.content_pack_export_items(tests.id('board_a'), '{"slug": "export-test"}', null, 100)
        -> 'items') x where x ->> 'key' = tests.id('x_board')::text)) v$$,
  $$values (null::text, true), ('debutant', true), ('intermediaire', true), ('avance', true),
      ('enrichi', true)$$,
  'the base and board levels'' versions travel with their keys; a personal level''s never does'
);
select ok(
  position(tests.id('teacher_a')::text in public.content_pack_export_items(tests.id('board_a'),
      '{"slug": "export-test", "includeTeacherItems": true, "includePackItems": true}', null, 100)::text) = 0
  and position('teacher_a' in public.content_pack_export_items(tests.id('board_a'),
      '{"slug": "export-test", "includeTeacherItems": true, "includePackItems": true}', null, 100)::text) = 0
  and position('School A1' in public.content_pack_export_items(tests.id('board_a'),
      '{"slug": "export-test", "includeTeacherItems": true, "includePackItems": true}', null, 100)::text) = 0
  and position(tests.id('school_a1')::text in public.content_pack_export_items(tests.id('board_a'),
      '{"slug": "export-test", "includeTeacherItems": true, "includePackItems": true}', null, 100)::text) = 0,
  'no author id or name, school name or school id appears in an export'
);
select is(
  (select jsonb_build_object(
     'first', jsonb_array_length(p1 -> 'items'), 'levels', jsonb_array_length(p1 -> 'levels'),
     'second', jsonb_array_length(p2 -> 'items'), 'secondLevels', p2 ? 'levels',
     'distinct', p1 #>> '{items,0,key}' <> p2 #>> '{items,0,key}', 'end', p2 -> 'next')
   from (select public.content_pack_export_items(tests.id('board_a'), '{"slug": "export-test",
           "publisher": "IP Lynx"}', null, 1) as p1) a
   cross join lateral (select public.content_pack_export_items(tests.id('board_a'),
           '{"slug": "export-test", "publisher": "IP Lynx"}', (p1 ->> 'next')::uuid, 1) as p2) b),
  '{"first": 1, "levels": 4, "second": 1, "secondLevels": false, "distinct": true, "end": null}'::jsonb,
  'paging follows `next` to the end; the board''s levels come with the first page only'
);
select throws_ok(
  $$select public.content_pack_export_items(tests.id('board_a'), '{"slug": "Pas un slug"}', null, 100)$$,
  '22023', null, 'an export needs a pack slug'
);
select lives_ok(
  $$select public.content_pack_record_export(tests.id('board_a'), 'export-test', '2026.2', 2,
      repeat('cd', 32))$$,
  'the CLI records a written export'
);
select tests.clear_authentication();
select results_eq(
  $$select actor_type::text, entity_id, details from public.audit_log
    where action = 'content_pack.exported' and board_id = tests.id('board_a')$$,
  $$values ('service', tests.id('board_a'), jsonb_build_object('slug', 'export-test',
      'version', '2026.2', 'item_count', 2, 'file_sha256', repeat('cd', 32)))$$,
  'an export is audited as the operator''s, with the pack''s slug, version and item count'
);

-- ---------------------------------------------------------------------------------------
-- 3. Staging and the dry run (D-100)
-- ---------------------------------------------------------------------------------------

-- Two references of board A share a title: an item naming it cannot be linked.
insert into public.catholic_references (board_id, type, title, text_fr) values
  (tests.id('board_a'), 'virtue', 'Le pardon', 'Pardonner.'),
  (tests.id('board_a'), 'virtue', 'Le pardon', 'Demander pardon.');

-- Pack « essai » 2026.1: 11 items.
select tests.keep_report('essai-1-items', jsonb_build_array(
  tests.pack_item('quiz-pret', 'quiz', jsonb_build_object('tags', jsonb_build_array(
    (select slug from public.tags where id = tests.id('tag_global'))))),
  -- A level this board does not have (niveau_a) instead of « debutant ».
  tests.pack_rehash(jsonb_set(tests.pack_item('fiche-niveaux', 'worksheet'), '{versions,1,level}',
    '"niveau_a"')),
  -- A worksheet without its level versions: never ready for approval.
  tests.pack_rehash(jsonb_set(tests.pack_item('fiche-incomplete', 'worksheet'), '{versions}',
    jsonb_build_array(tests.pack_item('fiche-incomplete', 'worksheet') #> '{versions,0}'))),
  tests.pack_item('attente-inconnue', 'song', jsonb_build_object('expectations', jsonb_build_array(
    jsonb_build_object('curriculumVersion', 'test', 'gradeCode', '3', 'code', 'T1.2'),
    jsonb_build_object('curriculumVersion', 'test', 'gradeCode', '3', 'code', 'T9.9')))),
  tests.pack_item('reflexion', 'catholic_reflection', jsonb_build_object('faith', jsonb_build_object(
    'faithContent', true, 'catholicConnection', 'Pardonner comme on aimerait être pardonné.',
    'reference', jsonb_build_object('type', 'virtue', 'title', 'Le pardon'),
    'onStudentSheet', false))),
  tests.pack_item('experience', 'experiment'),
  tests.pack_item('matiere-inconnue', 'song', '{"subjectCode": "zzz"}'),
  -- 31 new tags: the 31st is dropped.
  tests.pack_item('etiquettes-1', 'brain_break', jsonb_build_object('tags',
    (select jsonb_agg('etiq-' || lpad(n::text, 2, '0') order by n) from generate_series(1, 10) n))),
  tests.pack_item('etiquettes-2', 'brain_break', jsonb_build_object('tags',
    (select jsonb_agg('etiq-' || lpad(n::text, 2, '0') order by n) from generate_series(11, 20) n))),
  tests.pack_item('etiquettes-3', 'brain_break', jsonb_build_object('tags',
    (select jsonb_agg('etiq-' || lpad(n::text, 2, '0') order by n) from generate_series(21, 30) n))),
  tests.pack_item('etiquettes-4', 'brain_break', '{"tags": ["etiq-31"]}')));
select tests.keep_report('essai-tags',
  (select jsonb_agg(jsonb_build_object('slug', 'etiq-' || lpad(n::text, 2, '0'),
     'labelFr', 'Étiquette ' || n) order by n) from generate_series(1, 31) n));

select set_config('role', 'service_role', true);
select tests.remember('import_1', tests.stage_pack('board_a', 'essai', '2026.1',
  tests.report('essai-1-items'), tests.report('essai-tags')));
select tests.clear_authentication();

create function tests.pack_counts()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'items', (select count(*) from public.library_items),
    'versions', (select count(*) from public.library_item_versions),
    'tags', (select count(*) from public.tags),
    'packs', (select count(*) from public.content_packs),
    'audit', (select count(*) from public.audit_log),
    'events', (select count(*) from public.event_outbox),
    'staged', (select count(*) from public.content_pack_import_items),
    'imports', (select jsonb_agg(status order by id) from public.content_pack_imports));
$$;
select tests.keep_report('counts-before', tests.pack_counts());

select set_config('role', 'service_role', true);
select tests.keep_report('preview-1', public.content_pack_preview(tests.id('import_1'), '{}'));
select tests.keep_report('preview-1-mapped', public.content_pack_preview(tests.id('import_1'),
  '{"levelMap": {"niveau_a": "debutant"}}'));
select tests.clear_authentication();

select is(tests.pack_counts(), tests.report('counts-before'),
  'the dry run writes nothing: no item, version, tag, pack, audit line or event, and the import stays staged');
select results_eq(
  $$select key, outcome, queued from tests.pack_outcomes(tests.report('preview-1'))
    order by key collate "C"$$,
  $$values ('attente-inconnue', 'create', true), ('etiquettes-1', 'create', true),
      ('etiquettes-2', 'create', true), ('etiquettes-3', 'create', true),
      ('etiquettes-4', 'create', true), ('experience', 'create', true),
      ('fiche-incomplete', 'create', false), ('fiche-niveaux', 'create', false),
      ('matiere-inconnue', 'skipped_unresolved', false), ('quiz-pret', 'create', true),
      ('reflexion', 'create', true)$$,
  'the preview says what each item would become: created and queued, created as a draft, or skipped'
);
select is(
  tests.pack_warnings(tests.report('preview-1'), 'fiche-niveaux'),
  array['levelSkipped:niveau_a', 'notReady:levels'],
  'a version of a level the board does not have is skipped, and the item stays a draft'
);
select is(
  tests.pack_warnings(tests.report('preview-1-mapped'), 'fiche-niveaux'), '{}'::text[],
  '--level-map maps it to a board level'
);
select is(
  (select (x ->> 'queued')::boolean from jsonb_array_elements(tests.report('preview-1-mapped') -> 'items') x
   where x ->> 'key' = 'fiche-niveaux'),
  true, 'with every level mapped, the item would wait in the queue'
);
select is(
  tests.pack_warnings(tests.report('preview-1'), 'attente-inconnue'),
  array['expectationUnknown:test 3 T9.9'],
  'an attente that is not in the curriculum (exact version, grade and code) is a warning'
);
select is(
  tests.pack_warnings(tests.report('preview-1'), 'reflexion'), array['referenceAmbiguous'],
  'a Catholic reference whose title the board has twice is not linked, with a warning'
);
select is(
  tests.pack_warnings(tests.report('preview-1'), 'matiere-inconnue'), array['subjectUnknown:zzz'],
  'an unknown subject skips the item'
);
select is(
  jsonb_build_object('new', jsonb_array_length(tests.report('preview-1') -> 'newTags'),
    'dropped', tests.report('preview-1') -> 'droppedTags',
    'warning', to_jsonb(tests.pack_warnings(tests.report('preview-1'), 'etiquettes-4'))),
  '{"new": 30, "dropped": ["etiq-31"], "warning": ["tagDropped:etiq-31"]}'::jsonb,
  'at most 30 new tags per import: the 31st is dropped with a warning'
);

-- ---------------------------------------------------------------------------------------
-- 4. Applying (D-100)
-- ---------------------------------------------------------------------------------------

select set_config('role', 'service_role', true);
select tests.keep_report('apply-1', public.content_pack_apply(tests.id('import_1'),
  '{"levelMap": {"niveau_a": "debutant"}}'));
select tests.clear_authentication();

select results_eq(
  $$select key, outcome, queued from tests.pack_outcomes(tests.report('apply-1'))
    order by key collate "C"$$,
  $$select key, outcome, queued from tests.pack_outcomes(tests.report('preview-1-mapped'))
    order by key collate "C"$$,
  'applying does what the preview said'
);
select is(
  (select count(*)::int from public.library_items i
   where i.board_id = tests.id('board_a') and i.pack_slug = 'essai' and i.board_owned
     and i.author_id is null and i.school_id is null and i.share_scope = 'private'
     and i.source = 'board_created' and not i.sub_friendly and not i.no_derivatives
     and i.content_pack_id = (tests.report('apply-1') ->> 'packId')::uuid
     and i.pack_revision = i.content_revision and i.pack_content_hash ~ '^[0-9a-f]{64}$'),
  10, 'imported items are the board''s own, private, not for substitutes, with their pack, key, hash and revision'
);
select results_eq(
  $$select i.pack_item_key, i.status::text, i.review_requested_at is not null
    from public.library_items i where i.pack_slug = 'essai' and i.pack_item_key like 'fiche-%'
    order by 1$$,
  $$values ('fiche-incomplete', 'draft', false), ('fiche-niveaux', 'teacher_reviewed', true)$$,
  'a ready item waits for approval (reviewed, requested); one that is not stays a draft'
);
select is(
  (select pack_content_hash from public.library_items where id = tests.pack_item_id('essai', 'quiz-pret')),
  (select x ->> 'hash' from jsonb_array_elements(tests.report('essai-1-items')) x
   where x ->> 'key' = 'quiz-pret'),
  'the item keeps the pack item''s hash'
);
select results_eq(
  $$select coalesce(ll.code, 'base'), v.content ->> 'text', k.answer_key is not null
    from public.library_item_versions v
    left join public.language_levels ll on ll.id = v.language_level_id
    left join public.library_item_answer_keys k on k.version_id = v.id
    where v.item_id = tests.pack_item_id('essai', 'quiz-pret')
    order by ll.sort_order nulls first$$,
  $$values ('base', 'Le huard vit sur les lacs (base).', true),
      ('debutant', 'Le huard vit sur les lacs (debutant).', true),
      ('intermediaire', 'Le huard vit sur les lacs (intermediaire).', true),
      ('avance', 'Le huard vit sur les lacs (avance).', true),
      ('enrichi', 'Le huard vit sur les lacs (enrichi).', true)$$,
  'each version lands on its board level, with its key'
);
select is(
  (select ll.code from public.library_item_versions v
   join public.language_levels ll on ll.id = v.language_level_id
   where v.item_id = tests.pack_item_id('essai', 'fiche-niveaux')
     and v.content ->> 'text' = 'Le huard vit sur les lacs (debutant).'),
  'debutant', 'the version of the mapped level (niveau_a) is the board''s « debutant »'
);
select results_eq(
  $$select i.catholic_reference_id is null, i.faith_content, i.requires_faith_review
    from public.library_items i where i.id = tests.pack_item_id('essai', 'reflexion')$$,
  $$values (true, true, true)$$,
  'the ambiguous reference is left out; the reflection is faith content'
);
select results_eq(
  $$select ce.code from public.library_item_expectations le
    join public.curriculum_expectations ce on ce.id = le.expectation_id
    where le.item_id = tests.pack_item_id('essai', 'attente-inconnue')$$,
  $$values ('T1.2')$$,
  'the attentes that resolve are linked'
);
select is(
  (select array_agg(slug order by slug) from public.tags
   where board_id = tests.id('board_a') and slug like 'etiq-%'),
  (select array_agg('etiq-' || lpad(n::text, 2, '0') order by n) from generate_series(1, 30) n),
  'the 30 new tags are board A''s'
);
select results_eq(
  $$select slug, version, publisher, licence, file_sha256, item_count, approved_by,
      report -> 'counts' ->> 'created', report -> 'counts' ->> 'skippedUnresolved', manifest ->> 'checksum'
    from public.content_packs where id = (tests.report('apply-1') ->> 'packId')::uuid$$,
  $$values ('essai', '2026.1', 'Éditeur de test', 'Licence de test', repeat('ab', 32), 11,
      null::uuid, '10', '1', tests.pack_checksum(tests.report('essai-1-items')))$$,
  'the pack row records the declared publisher, licence, file hash, item count and report'
);
select results_eq(
  $$select actor_type::text, details ->> 'created', details ->> 'unchanged', details ->> 'skipped'
    from public.audit_log
    where action = 'content_pack.imported' and board_id = tests.id('board_a')$$,
  $$values ('service', '10', '0', '1')$$,
  'the import is audited as the operator''s, with its counts'
);
select results_eq(
  $$select aggregate_type, payload from public.event_outbox
    where event_type = 'content_pack.imported' and board_id = tests.id('board_a')$$,
  $$values ('content_pack', jsonb_build_object('packId', tests.report('apply-1') ->> 'packId'))$$,
  'content_pack.imported carries the pack id only'
);
select results_eq(
  $$select status, applied_at is not null,
      (select count(*)::int from public.content_pack_import_items ii where ii.import_id = i.id)
    from public.content_pack_imports i where i.id = tests.id('import_1')$$,
  $$values ('applied', true, 0)$$,
  'the import is applied and its staged items are gone'
);

select tests.authenticate_as('teacher_a');
select is(
  (select count(*)::int from public.library_items where pack_slug = 'essai'), 0,
  'teachers do not see imported items until they are approved'
);
select tests.clear_authentication();
select tests.authenticate_as('board_admin_a');
select is(
  (select count(*)::int from public.library_items where pack_slug = 'essai'), 10,
  'the board''s content reviewer sees them all'
);
select tests.clear_authentication();

select set_config('role', 'service_role', true);
select throws_ok(
  $$select tests.stage_pack('board_a', 'essai', '2026.1', tests.report('essai-1-items'))$$,
  'LXP01', null, 'a version already applied is refused'
);
select throws_ok(
  $$select tests.stage_pack('board_a', 'essai', '2025.9', tests.report('essai-1-items'))$$,
  'LXP02', null, 'a version below the applied one is refused'
);
select throws_ok(
  $$select public.content_pack_stage_items(tests.id('import_1'),
      jsonb_build_array(tests.report('essai-1-items') -> 0))$$,
  'LXP03', null, 'items cannot be staged into an applied import'
);
select throws_ok(
  $$select public.content_pack_apply(tests.id('import_1'), '{}')$$,
  'LXP03', null, 'an import is applied once'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 5. Approval by a named reviewer (D-100)
-- ---------------------------------------------------------------------------------------

select tests.keep_report('approbation-items', jsonb_build_array(
  tests.pack_item('a-quiz', 'quiz'),
  tests.pack_item('a-experience', 'experiment'),
  tests.pack_item('a-foi', 'song', jsonb_build_object('faith', jsonb_build_object(
    'faithContent', true, 'catholicConnection', '', 'reference', null, 'onStudentSheet', false))),
  tests.pack_item('a-suggere', 'song'),
  tests.pack_rehash(jsonb_set(tests.pack_item('a-brouillon', 'worksheet'), '{versions}',
    jsonb_build_array(tests.pack_item('a-brouillon', 'worksheet') #> '{versions,0}')))));

select set_config('role', 'service_role', true);
-- The CLI found faith words in « a-suggere ».
select tests.remember('import_2', tests.stage_pack('board_a', 'approbation', '2026.1',
  tests.report('approbation-items'), '[]', array['a-suggere']));
select throws_ok(
  format($$select public.content_pack_apply(%L, %L)$$, tests.id('import_2'),
    jsonb_build_object('approve', true, 'approverId', tests.id('teacher_a'))),
  'LXP04', null, '--approve with someone who is not a content reviewer of the board is refused'
);
select tests.keep_report('preview-2', public.content_pack_preview(tests.id('import_2'),
  jsonb_build_object('approve', true, 'approverId', tests.id('teacher_a'))));
select tests.clear_authentication();
select is(
  jsonb_build_object('approverOk', tests.report('preview-2') -> 'approverOk',
    'approved', (select count(*) from tests.pack_outcomes(tests.report('preview-2')) where approved),
    'staged', (select count(*) from public.content_pack_import_items where import_id = tests.id('import_2')),
    'packs', (select count(*) from public.content_packs where slug = 'approbation')),
  '{"approverOk": false, "approved": 0, "staged": 5, "packs": 0}'::jsonb,
  'the dry run reports the wrong approver instead; nothing was written by the refused apply'
);

select set_config('role', 'service_role', true);
select tests.keep_report('apply-2', public.content_pack_apply(tests.id('import_2'),
  jsonb_build_object('approve', true, 'approverId', tests.id('board_admin_a'))));
select tests.clear_authentication();
select results_eq(
  $$select key, outcome, queued, approved from tests.pack_outcomes(tests.report('apply-2'))
    order by key collate "C"$$,
  $$values ('a-brouillon', 'create', false, false), ('a-experience', 'create', true, false),
      ('a-foi', 'create', true, false), ('a-quiz', 'create', true, true),
      ('a-suggere', 'create', true, false)$$,
  'only ready items without faith content that are not experiments are approved'
);
select results_eq(
  $$select key, warnings from (
      select x ->> 'key' as key, x -> 'warnings' as warnings
      from jsonb_array_elements(tests.report('apply-2') -> 'items') x) w
    where key in ('a-experience', 'a-foi', 'a-suggere') order by key$$,
  $$values ('a-experience', '["approvalByReviewer"]'::jsonb), ('a-foi', '["approvalFaithReview"]'::jsonb),
      ('a-suggere', '["approvalFaithReview"]'::jsonb)$$,
  'experiments wait for a reviewer; faith content (the pack''s flag or faith words) for its faith review'
);
select results_eq(
  $$select status::text, share_scope::text, approved_by, approved_at is not null,
      review_requested_at is null, school_id is null
    from public.library_items where id = tests.pack_item_id('approbation', 'a-quiz')$$,
  $$values ('board_approved', 'board', tests.id('board_admin_a'), true, true, true)$$,
  'an approved import is board-wide, approved by the named reviewer'
);
select is(
  (select faith_content from public.library_items where id = tests.pack_item_id('approbation', 'a-suggere')),
  true, 'faith words the CLI found make the item faith content'
);
select results_eq(
  $$select a.actor_type::text, a.actor_user_id, a.details ->> 'via', (a.details ->> 'approved_by')::uuid,
      (select count(*)::int from public.event_outbox e
       where e.event_type = 'library_item.approved' and e.aggregate_id = a.entity_id)
    from public.audit_log a
    where a.action = 'library_item.approved' and a.board_id = tests.id('board_a')$$,
  $$values ('service', null::uuid, 'content_pack', tests.id('board_admin_a'), 1)$$,
  'the approval is audited as the operator''s with the approver, and library_item.approved is emitted once'
);
select is(
  (select approved_by from public.content_packs where slug = 'approbation'),
  tests.id('board_admin_a'), 'the pack row names the approver'
);

-- ---------------------------------------------------------------------------------------
-- 6. A later version (D-100): local edits win, approved items are never replaced
-- ---------------------------------------------------------------------------------------

-- Board A's reviewer approves one imported item; another is edited here.
select tests.authenticate_as('board_admin_a');
select public.library_decide(tests.pack_item_id('essai', 'attente-inconnue'), 'approve', null, 1);
select tests.clear_authentication();
select app.library_content_changed(tests.pack_item_id('essai', 'experience'));

-- 2026.2: three items changed, three identical, the tag items and the unresolved one gone.
select tests.keep_report('essai-2-items', (
  select jsonb_agg(case x ->> 'key'
      when 'quiz-pret' then tests.pack_rehash(x || '{"title": "Quiz prêt, deuxième version"}')
      when 'attente-inconnue' then tests.pack_rehash(x || '{"summary": "Nouveau résumé."}')
      when 'experience' then tests.pack_rehash(x || '{"materials": "Éponges et élastiques"}')
      else x end order by x ->> 'key')
  from jsonb_array_elements(tests.report('essai-1-items')) x
  where x ->> 'key' not like 'etiquettes-%' and x ->> 'key' <> 'matiere-inconnue'));

select set_config('role', 'service_role', true);
select tests.keep_report('apply-3', public.content_pack_apply(
  tests.stage_pack('board_a', 'essai', '2026.2', tests.report('essai-2-items')), '{}'));
select tests.clear_authentication();

select results_eq(
  $$select key, outcome from tests.pack_outcomes(tests.report('apply-3')) order by key collate "C"$$,
  $$values ('attente-inconnue', 'changed_not_applied'), ('experience', 'skipped_modified_locally'),
      ('fiche-incomplete', 'unchanged'), ('fiche-niveaux', 'unchanged'), ('quiz-pret', 'update'),
      ('reflexion', 'unchanged')$$,
  'a later version: identical items are unchanged, an approved one is not replaced, a locally edited one is skipped, an untouched one is updated'
);
select results_eq(
  $$select title, status::text, review_requested_at is not null, content_revision, pack_revision,
      content_pack_id = (tests.report('apply-3') ->> 'packId')::uuid
    from public.library_items where id = tests.pack_item_id('essai', 'quiz-pret')$$,
  $$values ('Quiz prêt, deuxième version', 'teacher_reviewed', true, 2, 2, true)$$,
  'the updated item is a new revision of the same item, and waits in the queue again'
);
select results_eq(
  $$select status::text, summary, pack_content_hash
    from public.library_items where id = tests.pack_item_id('essai', 'attente-inconnue')$$,
  $$select 'board_approved', null::text, x ->> 'hash'
    from jsonb_array_elements(tests.report('essai-1-items')) x where x ->> 'key' = 'attente-inconnue'$$,
  'the approved item keeps its content (« changée, non appliquée »)'
);
select is(
  (select materials from public.library_items where id = tests.pack_item_id('essai', 'experience')),
  'Crayons et feuilles', 'the locally edited item keeps the board''s edits (« modifiée localement »)'
);
select is(
  tests.report('apply-3') -> 'notInPack',
  '["etiquettes-1", "etiquettes-2", "etiquettes-3", "etiquettes-4"]'::jsonb,
  'items the new version no longer has are reported, not removed'
);
select is(
  (select report -> 'counts' from public.content_packs
   where id = (tests.report('apply-3') ->> 'packId')::uuid)
    - 'queued' - 'drafts' - 'approved',
  '{"created": 0, "updated": 1, "unchanged": 3, "changedNotApplied": 1, "skippedModifiedLocally": 1,
    "skippedDeletedLocally": 0, "skippedUnresolved": 0, "notInPack": 4}'::jsonb,
  'the pack row keeps the counts'
);

-- A reviewer withdraws the approved item (« Retirer de la banque »): it is no longer approved,
-- so the next version replaces it.
select tests.authenticate_as('board_admin_a');
select public.library_retract(tests.pack_item_id('essai', 'attente-inconnue'),
  'À revoir avec la prochaine version.');
select tests.clear_authentication();
select set_config('role', 'service_role', true);
select tests.keep_report('apply-4', public.content_pack_apply(
  tests.stage_pack('board_a', 'essai', '2026.3', tests.report('essai-2-items')), '{}'));
select tests.clear_authentication();
select results_eq(
  $$select key, outcome, queued from tests.pack_outcomes(tests.report('apply-4'))
    where key in ('attente-inconnue', 'quiz-pret') order by key$$,
  $$values ('attente-inconnue', 'update', true), ('quiz-pret', 'unchanged', false)$$,
  'a withdrawn item is replaced by the next version and waits for approval again'
);

-- ---------------------------------------------------------------------------------------
-- 7. Discarding, a cut-short staging, bad input
-- ---------------------------------------------------------------------------------------

select set_config('role', 'service_role', true);
select tests.remember('import_3', tests.stage_pack('board_a', 'essai', '2026.4',
  tests.report('essai-2-items')));
select lives_ok(
  format($$select public.content_pack_discard(%L)$$, tests.id('import_3')),
  'a staged import can be discarded'
);
select tests.clear_authentication();
select results_eq(
  $$select status, (select count(*)::int from public.content_pack_import_items ii where ii.import_id = i.id)
    from public.content_pack_imports i where i.id = tests.id('import_3')$$,
  $$values ('discarded', 0)$$,
  'discarding deletes its staged items'
);
select set_config('role', 'service_role', true);
select throws_ok(
  format($$select public.content_pack_stage_items(%L, %L)$$, tests.id('import_3'),
    jsonb_build_array(tests.report('essai-2-items') -> 0)),
  'LXP03', null, 'nothing is staged into a discarded import'
);

select tests.remember('import_4', public.content_pack_stage(tests.id('board_a'),
  tests.pack_header('essai', '2026.5', tests.report('essai-2-items')), repeat('ef', 32)));
select public.content_pack_stage_items(tests.id('import_4'),
  jsonb_build_array(tests.report('essai-2-items') -> 0, tests.report('essai-2-items') -> 1));
select throws_ok(
  format($$select public.content_pack_apply(%L, '{}')$$, tests.id('import_4')),
  'LXP05', null, 'an import whose items do not match the file''s checksum is refused'
);
select throws_ok(
  $$select public.content_pack_stage(tests.id('board_a'),
      jsonb_set(tests.pack_header('essai', '2026.6', tests.report('essai-2-items')),
        '{pack,version}', '"2026.06"'), repeat('ab', 32))$$,
  '22023', null, 'a version with a leading zero is refused'
);
select throws_ok(
  format($$select public.content_pack_stage_items(%L, %L)$$, tests.id('import_4'),
    (select jsonb_agg(tests.pack_item('lot-' || n, 'song')) from generate_series(1, 51) n)),
  '22023', null, 'at most 50 items per call'
);
select throws_ok(
  format($$select public.content_pack_apply(%L, %L)$$, tests.id('import_4'),
    '{"levelMap": {"debutant": "Débutant"}}'),
  '22023', null, 'a level map names level codes'
);

-- ---------------------------------------------------------------------------------------
-- 8. Listing, the board's people, the clean-up
-- ---------------------------------------------------------------------------------------

select results_eq(
  $$select x ->> 'slug', x ->> 'version', (x ->> 'itemCount')::int, (x ->> 'items')::int
    from jsonb_array_elements(public.content_pack_list(tests.id('board_a'))) x$$,
  $$values ('approbation', '2026.1', 5, 5), ('autre', '2026.1', 0, 1), ('essai', '2026.1', 11, 8),
      ('essai', '2026.2', 6, 1), ('essai', '2026.3', 6, 1), ('propre', '2026.1', 0, 1)$$,
  'list-packs: every pack of the board, by slug and version, with the items each still holds'
);
select is(
  (select jsonb_build_object(
     'students', (select jsonb_agg(s order by s) from jsonb_array_elements_text(p -> 'students') s),
     'teacherA', p -> 'staff' ? 'teacher_a', 'otherBoard', p -> 'staff' ? 'teacher_b')
   from (select public.content_pack_people(tests.id('board_a')) as p) x),
  '{"students": ["Léa", "Nathan", "Zoé"], "teacherA": true, "otherBoard": false}'::jsonb,
  'the name check gets the board''s students and staff, not another board''s'
);
select tests.clear_authentication();

update public.content_pack_imports set created_at = now() - interval '2 days'
where id = tests.id('import_4');
select is(app.content_pack_maintenance(), 1, 'the clean-up deletes imports older than a day');
select is(
  (select count(*)::int from public.content_pack_import_items where import_id = tests.id('import_4')),
  0, '… with their staged items'
);

select * from finish();
rollback;
