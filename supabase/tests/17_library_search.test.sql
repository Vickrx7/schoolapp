-- Phase 4 library search and browsing: the text query, who finds what, the order, the filters
-- and facets, and resources per attente (supabase/migrations/20261015090100_library_search.sql;
-- DECISIONS D-065, D-068, D-069).
begin;
\ir _helpers.psql
select plan(68);
select tests.build_fixture();
select tests.build_library_fixture();

-- A domaine for the test attentes, and a sibling of exp_a (T1.3) under the same overall attente.
insert into public.strands (id, subject_id, code, label_fr, curriculum_version)
values (tests.remember('strand_t', gen_random_uuid()),
  (select id from public.subjects where code = 'fra' and board_id is null), 'T', 'Domaine de test',
  'test');
update public.curriculum_expectations set strand_id = tests.id('strand_t')
where id in (tests.id('exp_a_parent'), tests.id('exp_a'));
insert into public.curriculum_expectations (id, subject_id, grade_code, strand_id, parent_id, kind,
  code, text_fr, curriculum_version)
values (tests.remember('exp_a_sibling', gen_random_uuid()),
  (select id from public.subjects where code = 'fra' and board_id is null), '3',
  tests.id('strand_t'), tests.id('exp_a_parent'), 'specific', 'T1.3',
  'Utiliser les caractéristiques d''un texte informatif.', 'test');
insert into public.language_levels (id, board_id, owner_user_id, code, label_fr)
values (tests.remember('level_personal_other', gen_random_uuid()), tests.id('board_a'),
  tests.id('teacher_a_other'), 'autre_test', 'Autre');

-- A ready item (tests.library_item) with its own title, base text and attente (null: none),
-- and its search document rebuilt. Level versions keep the fixture's text: only the base
-- version is searched.
create function tests.search_item(
  p_key text,
  p_author text,
  p_type public.library_item_type,
  p_status public.library_item_status,
  p_scope public.share_scope,
  p_title text,
  p_expectation text default 'exp_a',
  p_text text default 'Une ressource pour la classe.',
  p_board text default 'board_a'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  v_id := tests.library_item(p_key, p_author, p_type, p_status, p_scope,
    case when p_board = 'board_a' then 'school_a1' else 'school_b1' end, p_board);
  update public.library_items set title = p_title where id = v_id;
  update public.library_item_versions
  set content = jsonb_build_object('title', '', 'objective', 'Lire pour s’informer.',
    'teacherNote', '', 'text', p_text)
  where item_id = v_id and language_level_id is null;
  delete from public.library_item_expectations where item_id = v_id;
  if p_expectation is not null then
    insert into public.library_item_expectations (item_id, expectation_id)
    values (v_id, tests.id(p_expectation));
  end if;
  perform app.library_refresh_search(v_id);
  return v_id;
end;
$$;

-- The keys (tests.ids) of the items a search returns, in order, as the current user.
create function tests.search_keys(p_filters jsonb, p_limit integer default 50, p_offset integer default 0)
returns text[]
language sql
as $$
  select coalesce(array_agg(k.key order by x.n), '{}')
  from jsonb_array_elements(public.search_library(p_filters, p_limit, p_offset) -> 'items')
    with ordinality as x (item, n)
  join tests.ids k on k.id = (x.item ->> 'id')::uuid;
$$;

-- The same keys, sorted: for filters whose order does not matter.
create function tests.search_set(p_filters jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(tests.search_keys(p_filters)) k;
$$;

-- Who finds what (D-065). Board A, school A1 unless said otherwise.
select tests.search_item('own_draft', 'teacher_a', 'worksheet', 'draft', 'private', 'Fiche des castors');
select tests.search_item('own_rejected', 'teacher_a', 'game', 'rejected', 'private', 'Jeu à retravailler', null);
select tests.search_item('own_archived', 'teacher_a', 'game', 'archived', 'private', 'Jeu archivé');
select tests.search_item('other_draft', 'teacher_a_other', 'worksheet', 'draft', 'private',
  'Brouillon d’une collègue');
select tests.search_item('other_rejected', 'teacher_a_other', 'game', 'rejected', 'private',
  'Jeu refusé d’une collègue');
select tests.search_item('school_item', 'teacher_a_other', 'reading_passage', 'teacher_reviewed',
  'school', 'Le huard, oiseau des lacs', 'exp_a', 'Les huards plongent pour pêcher des poissons.');
select tests.search_item('board_item', 'teacher_a_other', 'stem_challenge', 'teacher_reviewed',
  'board', 'Défi STIM : le pont de papier', 'exp_a', 'Les élèves construisent un pont solide.');
select tests.search_item('approved', null, 'quiz', 'board_approved', 'board', 'Quiz des nombres');
select tests.search_item('requested', 'teacher_a_other', 'reading_passage', 'teacher_reviewed',
  'private', 'Texte en attente d’approbation');
select tests.library_request('requested');
select tests.search_item('faith_requested', 'teacher_a_other', 'catholic_reflection',
  'teacher_reviewed', 'private', 'Réflexion en attente', null);
select tests.library_request('faith_requested');
select tests.search_item('board_own_private', null, 'game', 'teacher_reviewed', 'private',
  'Jeu du conseil, non partagé', null);
select tests.search_item('school_a2_item', 'principal_a2', 'game', 'teacher_reviewed', 'school',
  'Jeu de l’école A2', null);
update public.library_items set school_id = tests.id('school_a2') where id = tests.id('school_a2_item');
select tests.search_item('board_b_item', 'teacher_b', 'worksheet', 'teacher_reviewed', 'board',
  'Fiche du conseil B', 'exp_a', 'Une ressource pour la classe.', 'board_b');

-- The order (grade 1 only): approved first, then titles in French order.
select tests.search_item(k, 'teacher_a_other', 'game', 'teacher_reviewed', 'board', t, null)
from (values ('o_zebre', 'Zèbre'), ('o_evaluation', 'Évaluation'), ('o_eau', 'eau'),
  ('o_eponges', 'Éponges'), ('o_arbre', 'Arbre')) v (k, t);
select tests.search_item('o_approved', null, 'game', 'board_approved', 'board', 'Zoo approuvé', null);
update public.library_item_grades set grade_code = '1'
where item_id in (select id from tests.ids where key like 'o\_%');

-- One item per filter, all shared with the board by teacher_a_other.
select tests.search_item('f_mat', 'teacher_a_other', 'worksheet', 'teacher_reviewed', 'board',
  'Fractions équivalentes', 'exp_other');
update public.library_items set subject_id = (select id from public.subjects where code = 'mat' and board_id is null)
where id = tests.id('f_mat');
update public.library_item_grades set grade_code = '5' where item_id = tests.id('f_mat');
select tests.search_item('f_parent', 'teacher_a_other', 'game', 'teacher_reviewed', 'board',
  'Jeu de l’attente générale', 'exp_a_parent');
select tests.search_item('f_sibling', 'teacher_a_other', 'game', 'teacher_reviewed', 'board',
  'Jeu de l’attente sœur', 'exp_a_sibling');
select tests.search_item('f_short', 'teacher_a_other', 'brain_break', 'teacher_reviewed', 'board',
  'Pause du miroir', null);
update public.library_items set duration_minutes = 10, is_projectable = true, sub_friendly = true
where id = tests.id('f_short');
select tests.search_item('f_long', 'teacher_a_other', 'project', 'teacher_reviewed', 'board',
  'Projet documentaire', null);
update public.library_items set duration_minutes = 90, is_printable = false, is_interactive = true
where id = tests.id('f_long');
update public.library_items set sub_friendly = true where id = tests.id('approved');
update public.library_items set summary = repeat('Un résumé très long. ', 20)
where id = tests.id('school_item');

-- Levels: teacher_a's own level on her draft, and (written directly, as no save allows it) a
-- colleague's personal level on an item shared with the board.
insert into public.library_item_versions (item_id, language_level_id, content)
select tests.id('own_draft'), tests.id('level_personal_a'), content
from public.library_item_versions where item_id = tests.id('own_draft') and language_level_id is null;
insert into public.library_item_versions (item_id, language_level_id, content)
select tests.id('board_item'), tests.id('level_personal_other'), content
from public.library_item_versions where item_id = tests.id('board_item') and language_level_id is null;

-- Words only in a level version or in an answer key are never searched.
update public.library_item_versions set content = content || '{"text": "Un motniveau caché."}'
where item_id = tests.id('approved') and language_level_id = tests.board_level('board_a', 'debutant');
update public.library_item_answer_keys set answer_key = '{"answers": [], "solution": "Le motcorrige."}'
where version_id = (select id from public.library_item_versions
                    where item_id = tests.id('approved') and language_level_id is null);
update public.library_item_versions set content = content || '{"objective": "Trouver l’idée principale."}'
where item_id = tests.id('school_item') and language_level_id is null;
select app.library_refresh_search(id) from public.library_items
where id in (select id from tests.ids);

-- ---------------------------------------------------------------------------------------
-- 1. Matching (D-068)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(tests.search_keys('{"q": "huard"}'), array['school_item'], 'a word of the title finds the item');
select is(tests.search_keys('{"q": "eleves"}'), array['board_item'],
  'a word typed without its accents finds « élèves »');
select is(tests.search_keys('{"q": "HUA"}'), array['school_item'],
  'the last word matches as a prefix, whatever its case');
select is(tests.search_keys('{"q": "defi-stim"}'), array['board_item'], '« defi-stim » finds « Défi STIM »');
select is(tests.search_set('{"q": "idee principale"}'),
  array['approved', 'board_item', 'own_draft', 'school_item'],
  'words typed without accents find « idée principale » in a base version or a linked attente');
select is(tests.search_keys('{"q": "idee pont"}'), array['board_item'], 'every word is required');
select is(tests.search_keys('{"q": "T1.3"}'), array['f_sibling'], 'an attente''s code finds its items');
select is(tests.search_keys('{"q": "motniveau"}'), '{}'::text[], 'level versions are not searched');
select is(tests.search_keys('{"q": "motcorrige"}'), '{}'::text[], 'answer keys are never searched');
select is(
  (public.search_library('{"q": "&|!:*()’\"<-> '' \\\\"}') ->> 'total')::int,
  (public.search_library('{}') ->> 'total')::int,
  'operators, quotes and backslashes are only separators: nothing is left to search for'
);
select is(
  (public.search_library('{"q": "le la de"}') ->> 'total')::int,
  (public.search_library('{}') ->> 'total')::int,
  'stop words alone do not filter'
);

-- ---------------------------------------------------------------------------------------
-- 2. Who finds what: exactly the usable items (app.library_item_usable_by), without archived
--    items or others' rejected ones (D-065)
-- ---------------------------------------------------------------------------------------

select tests.clear_authentication();
create table tests.usable (user_key text, item_id uuid);
insert into tests.usable (user_key, item_id)
select u.key, i.id
from tests.ids u cross join public.library_items i
where u.key in ('teacher_a', 'teacher_a_other', 'subject_teacher', 'principal_a', 'office_a',
    'principal_a2', 'board_admin_a', 'faith_reviewer_a', 'teacher_b', 'outsider')
  and app.library_item_usable_by(u.id, i.id)
  and i.status <> 'archived' and (i.status <> 'rejected' or i.author_id = u.id);
grant select on tests.usable to authenticated;

create function tests.search_ids()
returns setof uuid
language sql
as $$
  select (x ->> 'id')::uuid from jsonb_array_elements(public.search_library('{}', 50) -> 'items') x;
$$;

select tests.authenticate_as('teacher_a');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'teacher_a'$$,
  'teacher_a finds exactly the items she may use');
select tests.authenticate_as('teacher_a_other');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'teacher_a_other'$$,
  'teacher_a_other finds exactly the items she may use');
select tests.authenticate_as('subject_teacher');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'subject_teacher'$$,
  'a colleague of the school finds exactly the items he may use');
select tests.authenticate_as('principal_a');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'principal_a'$$,
  'the principal finds exactly the items she may use');
select tests.authenticate_as('office_a');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'office_a'$$,
  'office staff find exactly the shared items of their school and board');
select tests.authenticate_as('principal_a2');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'principal_a2'$$,
  'staff of another school of the board find exactly the items they may use');
select tests.authenticate_as('board_admin_a');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'board_admin_a'$$,
  'the board''s content reviewer finds exactly the items she may use');
select tests.authenticate_as('faith_reviewer_a');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'faith_reviewer_a'$$,
  'the faith reviewer finds exactly the items she may use');
select tests.authenticate_as('teacher_b');
select set_eq('select tests.search_ids()', $$select item_id from tests.usable where user_key = 'teacher_b'$$,
  'a teacher of another board finds exactly the items she may use');
select tests.authenticate_as('outsider');
select is_empty('select tests.search_ids()', 'a user without a role finds nothing');

select tests.authenticate_as('board_admin_a');
select ok(
  not (tests.search_keys('{}') && array['requested', 'faith_requested', 'board_own_private',
    'other_draft', 'other_rejected']),
  'items waiting for review, the board''s unshared items and others'' drafts never appear for a reviewer'
);
select tests.authenticate_as('faith_reviewer_a');
select ok(not ('faith_requested' = any (tests.search_keys('{}'))),
  'a faith review request does not put the item in the faith reviewer''s search');
select tests.authenticate_as('teacher_a');
select ok(
  tests.search_keys('{}') @> array['own_draft', 'own_rejected', 'school_item', 'board_item', 'approved']
  and not (tests.search_keys('{}') && array['own_archived', 'other_draft', 'other_rejected',
    'school_a2_item', 'board_b_item']),
  'a teacher finds her own drafts and sent-back items, and shared ones, never archived or others'' private items'
);
select tests.authenticate_as('teacher_a_other');
select results_eq(
  $$select (x ->> 'mine')::boolean, (x ->> 'requested')::boolean
    from jsonb_array_elements(public.search_library('{"q": "attente approbation"}') -> 'items') x$$,
  $$values (true, true)$$,
  'the author sees that her item waits for approval'
);
select tests.authenticate_as('teacher_a');
select results_eq(
  $$select (x ->> 'mine')::boolean, (x ->> 'requested')::boolean, char_length(x ->> 'summary'),
      right(x ->> 'summary', 1)
    from jsonb_array_elements(public.search_library('{"q": "huard"}') -> 'items') x$$,
  $$values (false, false, 200, '…')$$,
  'a colleague''s card says nothing of review, and summaries are cut at 200 characters'
);
select tests.authenticate_as('former_teacher');
select throws_ok($$select public.search_library('{}')$$, '42501', null,
  'a deactivated user cannot search');

-- ---------------------------------------------------------------------------------------
-- 3. Order: approved first, then titles in French order (D-068)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select is(tests.search_keys('{"gradeCode": "1"}'),
  array['o_approved', 'o_arbre', 'o_eau', 'o_eponges', 'o_evaluation', 'o_zebre'],
  'approved first, then « Arbre, eau, Éponges, Évaluation, Zèbre »');
select is(tests.search_keys('{"gradeCode": "1"}', 2, 2), array['o_eau', 'o_eponges'],
  'limit and offset page through the same order');
select is((public.search_library('{"gradeCode": "1"}', 2, 2) ->> 'total')::int, 6,
  'the total counts every page');

-- ---------------------------------------------------------------------------------------
-- 4. Filters (D-068, D-069)
-- ---------------------------------------------------------------------------------------

select is(tests.search_set('{"gradeCode": "5"}'), array['f_mat'], 'grade');
select is(tests.search_set(jsonb_build_object('subjectId',
    (select id from public.subjects where code = 'mat' and board_id is null))), array['f_mat'], 'subject');
select is(tests.search_set(jsonb_build_object('strandId', tests.id('strand_t'))),
  array['approved', 'board_item', 'f_parent', 'f_sibling', 'own_draft', 'school_item'],
  'domaine: items linked to one of its attentes');
select is(tests.search_set(jsonb_build_object('expectationId', tests.id('exp_a_parent'))),
  array['approved', 'board_item', 'f_parent', 'f_sibling', 'own_draft', 'school_item'],
  'an overall attente finds its items and those of its specific attentes');
select is(tests.search_set(jsonb_build_object('expectationId', tests.id('exp_a'))),
  array['approved', 'board_item', 'f_parent', 'own_draft', 'school_item'],
  'a specific attente finds its items and those of its overall attente, not its siblings''');
select is(tests.search_set('{"types": ["quiz"]}'), array['approved'], 'type');
select is(tests.search_set('{"types": ["quiz", "project"]}'), array['approved', 'f_long'],
  'several types: any of them');
select is(tests.search_set('{"buckets": ["explorer"]}'), array['board_item', 'f_long'], 'category');
select is(tests.search_set('{"duration": "le15"}'), array['f_short'], 'duration: 15 minutes or less');
select is(tests.search_set('{"duration": "gt60"}'), array['f_long'], 'duration: more than 60 minutes');
select is(tests.search_set('{"formats": ["interactive", "projectable"]}'), array['f_long', 'f_short'],
  'formats: any of them');
select is(tests.search_set('{"subFriendly": true}'), array['approved', 'f_short'], 'for substitutes');
select is(tests.search_set('{"approvedOnly": true}'), array['approved', 'o_approved'], 'approved only');
select is(tests.search_set(jsonb_build_object('languageLevelId', tests.board_level('board_a', 'debutant'))),
  array['approved', 'f_mat', 'own_draft', 'school_item'], 'a board level: items with a version for it');
select is(tests.search_set(jsonb_build_object('languageLevelId', tests.id('level_personal_a'))),
  array['own_draft'], 'the teacher''s own level');
select is(tests.search_set(jsonb_build_object('languageLevelId', tests.id('level_personal_other'))),
  '{}'::text[], 'a colleague''s personal level never matches');
select is(tests.search_set('{"mine": true}'), array['own_draft', 'own_rejected'], 'my resources');
select is(tests.search_set('{"q": null, "types": null, "mine": false, "approvedOnly": null}'),
  tests.search_set('{}'), 'JSON nulls and false switches are no filter');

-- ---------------------------------------------------------------------------------------
-- 5. Facets: each counts with every filter but its own (D-068)
-- ---------------------------------------------------------------------------------------

select is(public.search_library('{"types": ["quiz"]}') #>> '{facets,type,worksheet}', '2',
  'with « Quiz » chosen, the type facet still counts the worksheets');
select is(
  (public.search_library('{}') ->> 'total')::int,
  (select sum(value::int)::int from jsonb_each_text(public.search_library('{}') #> '{facets,type}')),
  'without a type filter, the total is the sum of the type facet'
);
select is(
  public.search_library('{"buckets": ["jouer"], "formats": ["projectable"]}') - 'items',
  jsonb_build_object('total', 1, 'facets', jsonb_build_object(
    'type', '{"brain_break": 1}'::jsonb, 'bucket', '{"jouer": 1}'::jsonb,
    'duration', '{"le15": 1, "le30": 0, "le60": 0, "gt60": 0}'::jsonb,
    'format', '{"printable": 10, "projectable": 1, "interactive": 0}'::jsonb,
    'subFriendly', 1, 'approved', 0, 'level', '{}'::jsonb)),
  'every facet follows the other filters and ignores its own'
);
select is(
  public.search_library('{}') #> '{facets,level}' ? tests.id('level_personal_a')::text
    and not public.search_library('{}') #> '{facets,level}' ? tests.id('level_personal_other')::text,
  true,
  'the level facet shows the teacher''s own level, never a colleague''s'
);
select is(public.search_library('{}') #>> array['facets', 'level', tests.board_level('board_a', 'debutant')::text],
  '4', 'the level facet counts items with a version for each board level');

-- ---------------------------------------------------------------------------------------
-- 6. Refusals
-- ---------------------------------------------------------------------------------------

select throws_ok($$select public.search_library('{"duration": "le45"}')$$, '22023', null,
  'an unknown duration is refused');
select throws_ok($$select public.search_library('{"formats": ["paper"]}')$$, '22023', null,
  'an unknown format is refused');
select throws_ok($$select public.search_library('{"types": ["poster"]}')$$, '22P02', null,
  'an unknown type is refused');
select throws_ok($$select public.search_library('{"grade": "3"}')$$, '22023', null,
  'an unknown filter is refused, so a misspelt filter never silently does nothing');
select throws_ok($$select public.search_library('{"types": "quiz"}')$$, '22023', null,
  'a list filter must be a list');
select tests.clear_authentication();
select ok(
  not has_function_privilege('authenticated', 'app.library_tsquery(text)', 'execute')
  and not has_function_privilege('authenticated', 'app.library_duration_band(smallint)', 'execute')
  and has_function_privilege('authenticated', 'public.search_library(jsonb,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.library_expectation_counts(text,uuid)', 'execute'),
  'only the two public functions are executable by authenticated users'
);

-- ---------------------------------------------------------------------------------------
-- 7. Resources per attente (D-069)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select results_eq(
  $$select c.expectation_id, c.item_count, c.approved_count
    from public.library_expectation_counts('3',
      (select id from public.subjects where code = 'fra' and board_id is null)) c
    where c.expectation_id in (tests.id('exp_a_parent'), tests.id('exp_a'), tests.id('exp_a_sibling'))
    order by c.expectation_id = tests.id('exp_a_parent') desc, c.expectation_id = tests.id('exp_a') desc$$,
  $$values (tests.id('exp_a_parent'), 6, 1), (tests.id('exp_a'), 5, 1), (tests.id('exp_a_sibling'), 2, 0)$$,
  'each attente counts all and approved resources with the same matching rule as the search'
);
select is(
  (select c.item_count from public.library_expectation_counts('3',
     (select id from public.subjects where code = 'fra' and board_id is null)) c
   where c.expectation_id = tests.id('exp_a')),
  (public.search_library(jsonb_build_object('gradeCode', '3', 'subjectId',
     (select id from public.subjects where code = 'fra' and board_id is null),
     'expectationId', tests.id('exp_a'))) ->> 'total')::int,
  'an attente''s count is the number of results its link opens'
);
select tests.authenticate_as('teacher_b');
select results_eq(
  $$select c.item_count, c.approved_count from public.library_expectation_counts('3',
      (select id from public.subjects where code = 'fra' and board_id is null)) c
    where c.expectation_id = tests.id('exp_a')$$,
  $$values (1, 0)$$,
  'counts follow who may use each resource'
);
select throws_ok($$select * from public.library_expectation_counts(null, null)$$, '22023', null,
  'counts need a grade and a subject');
select tests.authenticate_as('former_teacher');
select throws_ok(
  $$select * from public.library_expectation_counts('3', (select id from public.subjects where code = 'fra' and board_id is null))$$,
  '42501', null, 'a deactivated user gets no counts');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- 8. Numbers and curriculum codes as teachers type them (20261015090400_library_review_fixes.sql)
-- ---------------------------------------------------------------------------------------

select tests.search_item('n_mille', 'teacher_a_other', 'worksheet', 'teacher_reviewed', 'board',
  'Ordonner des nombres jusqu’à 1 000', null, E'Compare 2 500 et 2 050.');
-- Linked to the overall attente T1, with a 3 in its title: « T1.3 » split into words would find it.
select tests.search_item('code_parent', 'teacher_a_other', 'game', 'teacher_reviewed', 'board',
  'Jeu des 3 familles', 'exp_a_parent');

select tests.authenticate_as('teacher_a');
select is(tests.search_keys('{"q": "nombres 1000"}'), array['n_mille'],
  '« 1000 » finds « 1 000 »');
select is(tests.search_keys('{"q": "nombres 1 000"}'), array['n_mille'],
  'and so does « 1 000 »');
select is(tests.search_keys(jsonb_build_object('q', E'2 050')), array['n_mille'],
  'a number written with a no-break space finds it too');
select is(tests.search_set('{"q": "T1.3"}'), array['f_sibling'],
  'a code typed as written finds the items of that code only');
select tests.clear_authentication();

select * from finish();
rollback;
