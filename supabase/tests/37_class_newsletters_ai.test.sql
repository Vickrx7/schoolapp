-- « Info-parents », slice S3 (supabase/migrations/20270125090100_class_newsletters_ai.sql):
-- « Traduire en anglais (IA) ». The request built by the database from the stored message (the
-- paragraphs to translate, never an id, the class, the school or the signature in the text), who
-- may preview and ask, the scope, the limits and the error codes (LXN03 to LXN06, LXA01), and the
-- answer put back on its paragraphs only while the message is unchanged.
-- DECISIONS: D-139 (amends D-038, D-052, D-072).
begin;
\ir _helpers.psql
select plan(52);
select tests.build_fixture();

update public.schools set ai_enabled = true where id = tests.id('school_a1');

-- One paragraph as the app writes it.
create function tests.paragraph(p_id text, p_fr text, p_en text default '',
  p_en_from text default null, p_en_by text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object('id', p_id, 'fr', p_fr, 'en', p_en, 'enFrom', p_en_from,
    'enBy', p_en_by, 'from', jsonb_build_object('kind', 'typed'));
$$;

-- A message: the sections given (key, off, paragraphs), the others empty.
create function tests.message(p_sections jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object('v', 1, 'signature', 'Mme Signataire', 'sections', (
    select jsonb_agg(coalesce(
        (select s from jsonb_array_elements(p_sections) s where s ->> 'key' = k),
        jsonb_build_object('key', k, 'off', false, 'items', '[]'::jsonb)) order by n)
    from unnest(array['message', 'thisWeek', 'nextWeek', 'dates', 'reminders', 'atHome', 'faith',
      'closing']) with ordinality t (k, n)));
$$;

-- The usual message of these tests (P1 and P2 to translate with `missing`):
--   aaaa0001 up to date (by the app); aaaa0002 without English; aaaa0003 out of date (its French
--   changed); aaaa0004 up to date (its English was written for the same French, apostrophes and
--   spaces aside); a removed section's paragraph; a blank paragraph; aaaa0007 up to date.
create function tests.usual_message()
returns jsonb
language sql
as $$
  select tests.message(jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('aaaa0001', 'Bonjour chères familles,', 'Dear families,',
        'Bonjour chères familles,', 'app'),
      tests.paragraph('aaaa0002', 'Bravo à Léa !'))),
    jsonb_build_object('key', 'thisWeek', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('aaaa0003', 'Mathématiques : les fractions', 'Math: numbers',
        'Mathématiques : les nombres', 'teacher'),
      tests.paragraph('aaaa0004', 'Sciences : l’eau', 'Science: water',
        E'Sciences\u00a0:  l''eau ', 'teacher'))),
    jsonb_build_object('key', 'dates', 'off', true, 'items', jsonb_build_array(
      tests.paragraph('aaaa0005', 'Jeudi : sortie au musée'))),
    jsonb_build_object('key', 'reminders', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('aaaa0006', '   '))),
    jsonb_build_object('key', 'closing', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('aaaa0007', 'Bonne fin de semaine!', 'Have a good weekend!',
        'Bonne fin de semaine!', 'app')))));
$$;

-- A finished job, as the worker records it (no signed-in user).
create function tests.finish_job(p_job uuid, p_result jsonb)
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
  set status = 'succeeded', result = p_result, sent_text = 'Message hebdomadaire…',
      ai_generation_id = v_gen, finished_at = now()
  where id = p_job;
end;
$$;

-- A paragraph of a stored message, read as the owner.
create function tests.stored(p_newsletter uuid, p_item text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select i - 'from'
  from public.class_newsletters n,
    jsonb_array_elements(n.content -> 'sections') s,
    jsonb_array_elements(s -> 'items') i
  where n.id = p_newsletter and i ->> 'id' = p_item;
$$;

grant execute on function tests.paragraph(text, text, text, text, text), tests.message(jsonb),
  tests.usual_message(), tests.stored(uuid, text) to authenticated;

insert into public.class_newsletters (class_id, week_of, content) values
  (tests.id('class_a'), '2026-10-05', tests.usual_message()),
  (tests.id('class_a'), '2026-10-12', tests.message(jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('bbbb0001', 'Bonjour chères familles,', 'Dear families,',
        'Bonjour chères familles,', 'app'))))));
select tests.remember('n1', (select id from public.class_newsletters
  where class_id = tests.id('class_a') and week_of = '2026-10-05'));
select tests.remember('n_done', (select id from public.class_newsletters
  where class_id = tests.id('class_a') and week_of = '2026-10-12'));

-- ---------------------------------------------------------------------------------------
-- 1. The feature
-- ---------------------------------------------------------------------------------------

select lives_ok(
  $$insert into public.ai_jobs (board_id, school_id, user_id, feature, input) values
      (tests.id('board_a'), tests.id('school_a1'), tests.id('teacher_a'), 'newsletter_translate', '{}')$$,
  'jobs accept the feature newsletter_translate'
);
delete from public.ai_jobs;

select has_index('public', 'ai_jobs', 'ai_jobs_newsletter_open_idx',
  'a message''s open request is found by an index');

-- ---------------------------------------------------------------------------------------
-- 2. The preview: exactly the paragraphs to translate, built from the stored message
-- ---------------------------------------------------------------------------------------

select tests.authenticate_as('teacher_a');

select results_eq(
  $$select i ->> 'key', i ->> 'itemId', i ->> 'section', i ->> 'text'
    from jsonb_array_elements(public.newsletter_ai_preview(tests.id('n1'), 'missing') -> 'items') i$$,
  $$values ('P1', 'aaaa0002', 'message', 'Bravo à Léa !'),
    ('P2', 'aaaa0003', 'thisWeek', 'Mathématiques : les fractions')$$,
  '« missing »: the paragraphs without English or whose French changed, in order'
);

select is(
  public.newsletter_ai_preview(tests.id('n1'), 'missing') - 'items',
  jsonb_build_object('newsletterId', tests.id('n1'), 'revision', 1, 'scope', 'missing',
    'gradeLabels', jsonb_build_array('3e année'), 'sendKeys', null),
  'the request has the message, its revision, the scope and the grade, and no paragraph chosen yet'
);

select results_eq(
  $$select i ->> 'key', i ->> 'itemId'
    from jsonb_array_elements(public.newsletter_ai_preview(tests.id('n1'), 'all') -> 'items') i$$,
  $$values ('P1', 'aaaa0001'), ('P2', 'aaaa0002'), ('P3', 'aaaa0003'), ('P4', 'aaaa0004'),
    ('P5', 'aaaa0007')$$,
  '« all »: every French paragraph of the sections shown (never a removed section or a blank one)'
);

select ok(
  public.newsletter_ai_preview(tests.id('n1'), 'all')::text !~ '(Mme Signataire|Class A|School A1|English|Dear)',
  'no signature, class, school or English text in the request'
);

select tests.authenticate_as('subject_teacher');
select is(
  jsonb_array_length(public.newsletter_ai_preview(tests.id('n1'), 'missing') -> 'items'), 2,
  'a subject teacher of the class team previews too'
);

-- Everyone else: 42501.
select tests.authenticate_as('principal_a');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'the principal cannot preview');
select tests.authenticate_as('office_a');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'office staff cannot preview');
select tests.authenticate_as('board_admin_a');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'the board''s admin cannot preview');
select tests.authenticate_as('teacher_b');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'a teacher of another board cannot preview');
select tests.authenticate_as('teacher_a_other');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'a teacher of the same school, not on the class team, cannot preview');
select tests.clear_authentication();
insert into public.class_teachers (class_id, user_id, role)
values (tests.id('class_a'), tests.id('former_teacher'), 'subject');
select tests.authenticate_as('former_teacher');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'a deactivated member of the class team cannot preview');
select tests.clear_authentication();
update public.module_entitlements set enabled = false
where school_id = tests.id('school_a1') and module = 'teaching';
select tests.authenticate_as('teacher_a');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'missing')$$, '42501',
  null, 'not at a school without the Teaching module');
select tests.clear_authentication();
update public.module_entitlements set enabled = true
where school_id = tests.id('school_a1') and module = 'teaching';
select throws_ok(
  $$select app.newsletter_ai_input(null, tests.id('n1'), 'missing')$$, '42501', null,
  'no user, no request'
);

-- The scope, the message's state and its paragraphs' ids.
select tests.authenticate_as('teacher_a');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n1'), 'some')$$, '22023',
  null, 'an unknown scope is refused');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n_done'), 'missing')$$, 'LXN04',
  null, 'nothing to translate: LXN04');
select is(
  jsonb_array_length(public.newsletter_ai_preview(tests.id('n_done'), 'all') -> 'items'), 1,
  '« all » translates again what is up to date'
);
update public.class_newsletters set status = 'sent' where id = tests.id('n_done');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n_done'), 'all')$$, '22023',
  null, 'a message marked sent is never translated');
update public.class_newsletters set status = 'draft' where id = tests.id('n_done');
update public.class_newsletters set content = tests.message(jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('bbbb0001', 'Un'), tests.paragraph('bbbb0001', 'Deux')))))
where id = tests.id('n_done');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n_done'), 'all')$$, '22023',
  null, 'two paragraphs with one id are refused');

-- Too large for the AI: more than 60 paragraphs, or one French text over 1,000 characters.
update public.class_newsletters set content = tests.message((
    select jsonb_agg(jsonb_build_object('key', k, 'off', false, 'items', (
      select jsonb_agg(tests.paragraph(left(k, 1) || lpad((n * 10 + m)::text, 7, '0'), 'Bonjour'))
      from generate_series(1, 8) m)) order by n)
    from unnest(array['message', 'thisWeek', 'nextWeek', 'dates', 'reminders', 'atHome', 'faith',
      'closing']) with ordinality t (k, n)))
where id = tests.id('n_done');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n_done'), 'all')$$, 'LXN03',
  null, 'more than 60 paragraphs: LXN03');
update public.class_newsletters set content = tests.message(jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('bbbb0001', repeat('a', 1001))))))
where id = tests.id('n_done');
select throws_ok($$select public.newsletter_ai_preview(tests.id('n_done'), 'all')$$, 'LXN03',
  null, 'a French paragraph over 1,000 characters: LXN03');

-- ---------------------------------------------------------------------------------------
-- 3. The request: AI on, the previewed revision, the confirmed paragraphs, one at a time
-- ---------------------------------------------------------------------------------------

select tests.clear_authentication();
update public.schools set ai_enabled = false where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select throws_ok(
  $$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, array['P1'])$$,
  'LXA01', null, 'AI off at the school: LXA01'
);
select tests.clear_authentication();
update public.schools set ai_enabled = true where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');

select throws_ok(
  $$select public.request_newsletter_translation(tests.id('n1'), 'missing', 7, array['P1'])$$,
  'LXN05', null, 'a revision other than the one previewed: LXN05'
);
select is(
  tests.error_of($$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, array[]::text[])$$)
    || ' ' || tests.error_of($$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, array['P9'])$$)
    || ' ' || tests.error_of($$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, array['P1', 'P1'])$$)
    || ' ' || tests.error_of($$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, null)$$),
  '22023 22023 22023 22023',
  'no paragraph, an unknown one or one twice: 22023'
);

select tests.remember('job1', public.request_newsletter_translation(tests.id('n1'), 'missing', 1,
  array['P2', 'P1']));
select tests.clear_authentication();
select is(
  (select j.input from public.ai_jobs j where j.id = tests.id('job1')) - 'items',
  jsonb_build_object('newsletterId', tests.id('n1'), 'revision', 1, 'scope', 'missing',
    'gradeLabels', jsonb_build_array('3e année'), 'sendKeys', jsonb_build_array('P1', 'P2')),
  'the job holds the request with the confirmed paragraphs, in the message''s order'
);
select is(
  (select j.feature || ' ' || j.status || ' ' || j.user_id::text from public.ai_jobs j
   where j.id = tests.id('job1')),
  'newsletter_translate queued ' || tests.id('teacher_a')::text,
  'queued as the requester'
);

select tests.authenticate_as('teacher_a');
select is(
  public.request_newsletter_translation(tests.id('n1'), 'all', 1, array['P1']),
  tests.id('job1'),
  'a second tap while it runs gives the same request'
);
select tests.authenticate_as('subject_teacher');
select throws_ok(
  $$select public.request_newsletter_translation(tests.id('n1'), 'missing', 1, array['P1'])$$,
  'LXN06', null, 'a colleague''s translation of the message is running: LXN06'
);

-- ---------------------------------------------------------------------------------------
-- 4. The answer: on its paragraphs, as the requester, while the message is unchanged
-- ---------------------------------------------------------------------------------------

select tests.clear_authentication();
select tests.finish_job(tests.id('job1'), jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'P1', 'text', '  Congratulations to Léa!  '),
  jsonb_build_object('key', 'P2', 'text', 'Math: fractions'),
  jsonb_build_object('key', 'P2', 'text', 'A second answer for P2'))));

select is(
  (select j.status || ' ' || coalesce(j.error_code, '-') from public.ai_jobs j
   where j.id = tests.id('job1')),
  'succeeded -', 'the job succeeded'
);
select is(
  (select j.result -> 'applied' from public.ai_jobs j where j.id = tests.id('job1')),
  '2'::jsonb, 'its result says how many paragraphs were written'
);
select is(
  (select j.result ->> 'newsletterId' from public.ai_jobs j where j.id = tests.id('job1')),
  tests.id('n1')::text, 'and for which message'
);
select is(
  tests.stored(tests.id('n1'), 'aaaa0002'),
  jsonb_build_object('id', 'aaaa0002', 'fr', 'Bravo à Léa !', 'en', 'Congratulations to Léa!',
    'enFrom', 'Bravo à Léa !', 'enBy', 'ai'),
  'a paragraph without English gets the AI''s, for its French'
);
select is(
  tests.stored(tests.id('n1'), 'aaaa0003'),
  jsonb_build_object('id', 'aaaa0003', 'fr', 'Mathématiques : les fractions',
    'en', 'Math: fractions', 'enFrom', 'Mathématiques : les fractions', 'enBy', 'ai'),
  'an out-of-date paragraph is brought up to date (the first answer of a key)'
);
select is(
  tests.stored(tests.id('n1'), 'aaaa0001') ->> 'enBy' || ' ' ||
    (tests.stored(tests.id('n1'), 'aaaa0005') ->> 'en'),
  'app ',
  'every other paragraph stays as it was'
);
select is(
  (select n.revision || ' ' || (select key from tests.ids where id = n.updated_by)
   from public.class_newsletters n where n.id = tests.id('n1')),
  '2 teacher_a',
  'the revision moves on, written as the requester (the worker signs in as nobody)'
);
select is(
  (select n.content ->> 'signature' from public.class_newsletters n where n.id = tests.id('n1')),
  'Mme Signataire', 'the signature is kept'
);

-- A paragraph the teacher did not confirm is never written, even if answered.
select tests.authenticate_as('teacher_a');
select tests.remember('job2', public.request_newsletter_translation(tests.id('n1'), 'all', 2,
  array['P2']));
select tests.clear_authentication();
select tests.finish_job(tests.id('job2'), jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'P1', 'text', 'Hello, families!'),
  jsonb_build_object('key', 'P2', 'text', 'Well done, Léa!'))));
select is(
  (select (j.result ->> 'applied') || ' ' ||
     (tests.stored(tests.id('n1'), 'aaaa0001') ->> 'en') || ' / ' ||
     (tests.stored(tests.id('n1'), 'aaaa0002') ->> 'en')
   from public.ai_jobs j where j.id = tests.id('job2')),
  '1 Dear families, / Well done, Léa!',
  'only the confirmed paragraphs are written'
);

-- The message changed after the request: nothing is written (newsletterChanged).
select tests.authenticate_as('teacher_a');
select tests.remember('job3', public.request_newsletter_translation(tests.id('n1'), 'all', 3,
  array['P1']));
update public.class_newsletters
set content = jsonb_set(content, '{signature}', '"Mme Autre"')
where id = tests.id('n1');
select tests.clear_authentication();
select tests.finish_job(tests.id('job3'), jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'P1', 'text', 'Hello!'))));
select is(
  (select j.status || ' ' || j.error_code || ' ' || coalesce(j.result::text, 'null')
   from public.ai_jobs j where j.id = tests.id('job3')),
  'failed newsletterChanged null',
  'a message saved since the request: the job fails with newsletterChanged and keeps nothing'
);
select is(
  tests.stored(tests.id('n1'), 'aaaa0001') ->> 'en', 'Dear families,',
  'and the message is untouched'
);

-- Marked sent since the request: nothing is written either.
select tests.authenticate_as('teacher_a');
select tests.remember('job4', public.request_newsletter_translation(tests.id('n1'), 'all', 4,
  array['P1']));
update public.class_newsletters set status = 'sent' where id = tests.id('n1');
select tests.clear_authentication();
select tests.finish_job(tests.id('job4'), jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'P1', 'text', 'Hello!'))));
select is(
  (select j.status || ' ' || j.error_code from public.ai_jobs j where j.id = tests.id('job4')),
  'failed newsletterChanged',
  'a message marked sent since the request is never changed'
);
update public.class_newsletters set status = 'draft' where id = tests.id('n1');

-- An answer that cannot be read: invalidOutput, nothing written.
select tests.authenticate_as('teacher_a');
select tests.remember('job5', public.request_newsletter_translation(tests.id('n1'), 'all', 4,
  array['P1']));
select tests.clear_authentication();
select tests.finish_job(tests.id('job5'), jsonb_build_object('items', 'nothing'));
select is(
  (select j.status || ' ' || j.error_code || ' ' || coalesce(j.result::text, 'null')
   from public.ai_jobs j where j.id = tests.id('job5')),
  'failed invalidOutput null',
  'an unusable answer fails with invalidOutput'
);
select is(
  (select n.revision from public.class_newsletters n where n.id = tests.id('n1')), 4,
  'and writes nothing'
);

-- A message that would grow past what the app reads: newsletterTooLargeForAi.
update public.class_newsletters set content = tests.message(jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      tests.paragraph('cccc0001', 'Bonjour', repeat('x', 58500), 'Bonjour', 'teacher'),
      tests.paragraph('cccc0002', 'Bravo !')))))
where id = tests.id('n_done');
select ok(
  (select octet_length(content::text) between 58500 and 60000 from public.class_newsletters
   where id = tests.id('n_done')),
  'a message just under the size the app reads'
);
select tests.authenticate_as('teacher_a');
select tests.remember('job6', public.request_newsletter_translation(tests.id('n_done'), 'missing',
  (select revision from public.class_newsletters where id = tests.id('n_done')), array['P1']));
select tests.clear_authentication();
select tests.finish_job(tests.id('job6'), jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'P1', 'text', repeat('Well done! ', 150)))));
select is(
  (select j.status || ' ' || j.error_code from public.ai_jobs j where j.id = tests.id('job6')),
  'failed newsletterTooLargeForAi',
  'an answer that would make the message too large is not written'
);
select is(
  tests.stored(tests.id('n_done'), 'cccc0002') ->> 'en', '',
  'and the paragraph keeps its empty English'
);

-- The text key: as @lynx/domain sameFrench.
select is(
  app.newsletter_text_key(E'  L’eau\u00a0:\u202f la  « pluie » '), 'L''eau : la « pluie »',
  'spaces and apostrophes do not make a French text different'
);

-- ---------------------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.newsletter_ai_preview(uuid, text)', 'execute')
    and has_function_privilege('authenticated',
      'public.request_newsletter_translation(uuid, text, integer, text[])', 'execute'),
  'signed-in users run the preview and the request'
);
select ok(
  not has_function_privilege('anon', 'public.newsletter_ai_preview(uuid, text)', 'execute')
    and not has_function_privilege('anon',
      'public.request_newsletter_translation(uuid, text, integer, text[])', 'execute'),
  'anon runs neither'
);
select ok(
  has_function_privilege('service_role', 'app.newsletter_ai_input(uuid, uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.newsletter_ai_input(uuid, uuid, text)',
      'execute')
    and not has_function_privilege('anon', 'app.newsletter_ai_input(uuid, uuid, text)', 'execute'),
  'the input builder takes a user: the service role only'
);
select ok(
  not has_function_privilege('authenticated',
      'app.newsletter_translation_from_job(public.ai_jobs)', 'execute')
    and not has_function_privilege('authenticated', 'app.ai_jobs_apply_newsletter()', 'execute')
    and not has_function_privilege('authenticated', 'app.newsletter_text_key(text)', 'execute'),
  'the answer''s helpers are reached only through the worker''s update'
);
select ok(
  has_function_privilege('anon', 'public.sign_in_attempt(text, text, text)', 'execute'),
  'anon keeps the sign-in throttle (the revoke is by name)'
);

select * from finish();
rollback;
