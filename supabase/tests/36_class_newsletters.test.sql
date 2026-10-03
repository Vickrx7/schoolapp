-- « Info-parents », slice S1 (supabase/migrations/20270125090000_class_newsletters.sql): the
-- class's weekly message to families, the class team's only, what the database sets, the week
-- and purge checks (LXN01, LXN02) and the year-end purge that now takes the messages.
-- DECISIONS: D-105 (amended), D-136, D-137, D-138.
-- The new table's owner assertions (row level security, nothing for anon, the grants) live here
-- rather than in 00_schema_invariants, so this file has one owner.
begin;
\ir _helpers.psql
select plan(56);
select tests.build_fixture();

-- A minimal message the database accepts (the app checks the rest, D-137).
create function tests.newsletter_content(p_text text default 'Bonjour chères familles,')
returns jsonb
language sql
as $$
  select jsonb_build_object('v', 1, 'signature', 'Mme A', 'sections', jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      jsonb_build_object('id', 'abcd1234', 'fr', p_text, 'en', '', 'enFrom', null, 'enBy', null,
        'from', jsonb_build_object('kind', 'typed'))))));
$$;

-- Inserts a message of class_a as the signed-in user and returns its id.
create function tests.newsletter(p_week date, p_class text default 'class_a')
returns uuid
language sql
as $$
  insert into public.class_newsletters (class_id, week_of, content)
  values (tests.id(p_class), p_week, tests.newsletter_content())
  returning id;
$$;

-- What the database set on a message, read as the owner.
create function tests.newsletter_state(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select n.status || ' r' || n.revision || ' sent:' || (n.sent_at is not null)::text
    || ' by:' || coalesce((select key from tests.ids where id = n.created_by), '-')
    || '/' || coalesce((select key from tests.ids where id = n.updated_by), '-')
  from public.class_newsletters n where n.id = p_id;
$$;

grant execute on function tests.newsletter_content(text), tests.newsletter(date, text),
  tests.newsletter_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- The table's protections
-- ---------------------------------------------------------------------------------------

select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.class_newsletters'::regclass),
  'class_newsletters has row level security'
);

select is_empty(
  $$select p.priv
    from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
      'trigger']) p (priv)
    where has_table_privilege('anon', 'public.class_newsletters', p.priv)
      or (p.priv in ('select', 'insert', 'update', 'references')
        and has_any_column_privilege('anon', 'public.class_newsletters', p.priv))$$,
  'anon has no privilege on class_newsletters'
);

select results_eq(
  $$select a.attname::text collate "default",
      has_column_privilege('authenticated', 'public.class_newsletters', a.attname, 'insert'),
      has_column_privilege('authenticated', 'public.class_newsletters', a.attname, 'update')
    from pg_attribute a
    where a.attrelid = 'public.class_newsletters'::regclass and a.attnum > 0 and not a.attisdropped
    order by a.attnum$$,
  $$values ('id', false, false), ('class_id', true, false), ('week_of', true, false),
    ('content', true, true), ('status', false, true), ('sent_at', false, false),
    ('revision', false, false), ('created_by', false, false), ('updated_by', false, false),
    ('created_at', false, false), ('updated_at', false, false)$$,
  'insert the class, week and content; update the content and status; the rest is the database''s'
);

select ok(
  has_table_privilege('authenticated', 'public.class_newsletters', 'select')
  and has_table_privilege('authenticated', 'public.class_newsletters', 'delete')
  and not has_table_privilege('authenticated', 'public.class_newsletters', 'truncate'),
  'authenticated selects and deletes messages (row level security decides which)'
);

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'class_newsletters_created_by_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'class_newsletters_updated_by_idx'),
  'both user foreign keys are indexed (the class''s is the unique key''s first column)'
);

select results_eq(
  $$select conname::text collate "default", confdeltype::text collate "default"
    from pg_constraint
    where conrelid = 'public.class_newsletters'::regclass and contype = 'f' order by conname$$,
  $$values ('class_newsletters_class_id_fkey', 'c'), ('class_newsletters_created_by_fkey', 'n'),
    ('class_newsletters_updated_by_fkey', 'n')$$,
  'messages go with their class; an author''s account deleted leaves the message'
);

select ok(
  not has_function_privilege('authenticated', 'app.class_newsletters_before_write()', 'execute')
  and not has_function_privilege('anon', 'app.class_newsletters_before_write()', 'execute')
  and not has_function_privilege('authenticated', 'app.purge_class_students(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.purge_class_students(uuid)', 'execute'),
  'nobody signed in runs the trigger function or the purge'
);

-- ---------------------------------------------------------------------------------------
-- The class team writes them (D-136)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('nl_1', tests.newsletter('2026-10-05'))$$,
  'the homeroom teacher prepares a message for a week of the class''s year'
);
select is(tests.newsletter_state(tests.id('nl_1')), 'draft r1 sent:false by:teacher_a/teacher_a',
  'a new message is a draft, revision 1, by its author');
select is((select count(*)::int from public.class_newsletters), 1, 'she reads it');
select lives_ok(
  $$update public.class_newsletters set content = tests.newsletter_content('Bonjour à tous!')
    where id = tests.id('nl_1')$$,
  'she saves it'
);
select is(tests.newsletter_state(tests.id('nl_1')), 'draft r2 sent:false by:teacher_a/teacher_a',
  'a change of content bumps the revision');
select throws_ok(
  $$update public.class_newsletters set revision = 9 where id = tests.id('nl_1')$$,
  '42501', null, 'the revision is the database''s'
);
select throws_ok(
  $$update public.class_newsletters set sent_at = now() where id = tests.id('nl_1')$$,
  '42501', null, 'so is the date it was sent'
);
select throws_ok(
  $$update public.class_newsletters set week_of = '2026-10-12' where id = tests.id('nl_1')$$,
  '42501', null, 'a message keeps its week'
);
select throws_ok(
  $$insert into public.class_newsletters (class_id, week_of, content, created_by)
    values (tests.id('class_a'), '2026-10-19', tests.newsletter_content(), tests.id('teacher_b'))$$,
  '42501', null, 'the author is not given by the caller'
);
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
select is((select count(*)::int from public.class_newsletters), 1,
  'a subject teacher of the class reads its messages');
select lives_ok(
  $$update public.class_newsletters set content = tests.newsletter_content('Un mot de M. B.')
    where id = tests.id('nl_1')$$,
  'and edits them'
);
select is(tests.newsletter_state(tests.id('nl_1')), 'draft r3 sent:false by:teacher_a/subject_teacher',
  'the last editor is kept');
select lives_ok(
  $$update public.class_newsletters set status = 'sent' where id = tests.id('nl_1')$$,
  '« Marquer comme envoyé »'
);
select is(tests.newsletter_state(tests.id('nl_1')), 'sent r3 sent:true by:teacher_a/subject_teacher',
  'marked sent: the date is set, the revision and the editor are unchanged');
select lives_ok(
  $$update public.class_newsletters set status = 'draft' where id = tests.id('nl_1')$$,
  '« Remettre en brouillon »'
);
select is(tests.newsletter_state(tests.id('nl_1')), 'draft r3 sent:false by:teacher_a/subject_teacher',
  'back to a draft: the date is cleared');
select throws_ok(
  $$update public.class_newsletters set status = 'final' where id = tests.id('nl_1')$$,
  '23514', null, 'a message is a draft or sent'
);
select tests.clear_authentication();

-- The worker (slice S3) writes as the owner and names the person it writes for.
update public.class_newsletters set content = tests.newsletter_content('Hello'),
  updated_by = tests.id('teacher_a') where id = tests.id('nl_1');
select is(tests.newsletter_state(tests.id('nl_1')), 'draft r4 sent:false by:teacher_a/teacher_a',
  'without a signed-in user, the editor given is kept');

-- ---------------------------------------------------------------------------------------
-- Nobody else (D-136)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.class_newsletters), 0,
  'the principal reads no message');
select throws_ok($$select tests.newsletter('2026-10-19')$$, '42501', null,
  'nor prepares one');
select is_empty(
  $$update public.class_newsletters set status = 'sent' where id = tests.id('nl_1') returning id$$,
  'nor changes one'
);
select is_empty(
  $$delete from public.class_newsletters where id = tests.id('nl_1') returning id$$,
  'nor deletes one'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select is((select count(*)::int from public.class_newsletters), 0, 'office staff read none');
select throws_ok($$select tests.newsletter('2026-10-19')$$, '42501', null,
  'nor prepare one');
select tests.clear_authentication();

select tests.authenticate_as('board_admin_a');
select is((select count(*)::int from public.class_newsletters), 0, 'a board admin reads none');
select throws_ok($$select tests.newsletter('2026-10-19')$$, '42501', null,
  'nor prepares one');
select tests.clear_authentication();

select tests.authenticate_as('teacher_b');
select is((select count(*)::int from public.class_newsletters), 0,
  'a teacher of another board reads none');
select throws_ok($$select tests.newsletter('2026-10-19')$$, '42501', null,
  'nor prepares one for a class she does not teach');
select tests.clear_authentication();

select tests.authenticate_as('teacher_a_other');
select is((select count(*)::int from public.class_newsletters), 0,
  'a teacher of another class of the school reads none');
select tests.clear_authentication();

-- A deactivated account, even on the class team.
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a'), tests.id('former_teacher'), 'subject');
select tests.authenticate_as('former_teacher');
select is((select count(*)::int from public.class_newsletters), 0,
  'a deactivated member of the class team reads none');
select throws_ok($$select tests.newsletter('2026-10-19')$$, '42501', null,
  'nor prepares one');
select tests.clear_authentication();

-- A member whose teacher role was removed.
delete from public.user_roles
where user_id = tests.id('subject_teacher') and role = 'teacher';
select tests.authenticate_as('subject_teacher');
select is((select count(*)::int from public.class_newsletters), 0,
  'a team member without a teacher role any more reads none');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- The week and the content (D-137, LXN01)
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');
select throws_ok($$select tests.newsletter('2026-10-06')$$, '23514', null,
  'a week starts on a Monday');
select throws_ok($$select tests.newsletter('2027-07-05')$$, 'LXN01', null,
  'a week after the class''s school year: LXN01');
select throws_ok($$select tests.newsletter('2026-08-24')$$, 'LXN01', null,
  'a week before it: LXN01');
select lives_ok($$select tests.newsletter('2026-08-31')$$,
  'a week whose Friday is in the year (it starts on a Tuesday) is accepted');
select lives_ok($$select tests.newsletter('2027-06-28')$$,
  'so is the year''s last week');
select throws_ok($$select tests.newsletter('2026-10-05')$$, '23505', null,
  'one message per class and week');
select throws_ok(
  $$insert into public.class_newsletters (class_id, week_of, content)
    values (tests.id('class_a'), '2026-11-02', '[]'::jsonb)$$,
  '23514', null, 'the content is an object'
);
select throws_ok(
  $$insert into public.class_newsletters (class_id, week_of, content)
    values (tests.id('class_a'), '2026-11-02', tests.newsletter_content() || '{"v": 2}')$$,
  '23514', null, 'of version 1'
);
select throws_ok(
  $$insert into public.class_newsletters (class_id, week_of, content)
    values (tests.id('class_a'), '2026-11-02', tests.newsletter_content() || '{"sections": {}}')$$,
  '23514', null, 'with its sections in a list'
);
select throws_ok(
  $$update public.class_newsletters
    set content = tests.newsletter_content(repeat(md5(random()::text), 2200))
    where id = tests.id('nl_1')$$,
  '23514', null, 'and at most 64 KB'
);
select lives_ok(
  $$delete from public.class_newsletters where week_of = '2027-06-28'$$,
  'the class team deletes a message'
);
select is((select count(*)::int from public.class_newsletters), 2,
  'it is gone; the others stay');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------
-- The year-end purge takes the messages (D-105 as amended, D-138; LXN02)
-- ---------------------------------------------------------------------------------------

create temporary table purge_marker as select coalesce(max(id), 0) as audit_id from public.audit_log;
do $$ begin perform app.purge_class_students(tests.id('class_a')); end $$;
select is(
  (select count(*)::int from public.class_newsletters where class_id = tests.id('class_a')), 0,
  'purging a class''s students deletes its messages'
);
select results_eq(
  $$select details from public.audit_log
    where id > (select audit_id from purge_marker) and action = 'class.students_purged'$$,
  $$values ('{"students": 2, "newsletters": 2}'::jsonb)$$,
  'and the audit entry counts them'
);
select tests.authenticate_as('teacher_a');
select throws_ok($$select tests.newsletter('2026-10-19')$$, 'LXN02', null,
  'no message after the purge: LXN02');
select tests.clear_authentication();

-- A class without messages keeps the entry it always had.
create temporary table purge_marker_2 as select max(id) as audit_id from public.audit_log;
do $$ begin perform app.purge_class_students(tests.id('class_a_other')); end $$;
select results_eq(
  $$select details from public.audit_log
    where id > (select audit_id from purge_marker_2) and action = 'class.students_purged'$$,
  $$values ('{"students": 1}'::jsonb)$$,
  'a class that never used Info-parents: the students only'
);

-- A class deleted takes its messages.
select tests.authenticate_as('teacher_b');
do $$ begin perform tests.remember('nl_b', tests.newsletter('2026-10-05', 'class_b')); end $$;
select tests.clear_authentication();
delete from public.classes where id = tests.id('class_b');
select is(
  (select count(*)::int from public.class_newsletters where id = tests.id('nl_b')), 0,
  'a message goes with its class'
);

select * from finish();
rollback;
