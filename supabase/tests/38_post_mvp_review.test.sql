-- The post-MVP review, round A (supabase/migrations/20270201090000_post_mvp_review_fixes.sql): a
-- message marked « Envoyé » keeps the text that went to families (LXN07) until it is put back to a
-- draft; marking it sent or back is unchanged. DECISIONS: D-136, D-137 (amended).
begin;
\ir _helpers.psql
select plan(9);
select tests.build_fixture();

create function tests.review_content(p_text text)
returns jsonb
language sql
as $$
  select jsonb_build_object('v', 1, 'signature', 'Mme A', 'sections', jsonb_build_array(
    jsonb_build_object('key', 'message', 'off', false, 'items', jsonb_build_array(
      jsonb_build_object('id', 'abcd1234', 'fr', p_text, 'en', '', 'enFrom', null, 'enBy', null,
        'from', jsonb_build_object('kind', 'typed'))))));
$$;

create function tests.review_state(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select n.status || ' r' || n.revision || ' '
    || (n.content -> 'sections' -> 0 -> 'items' -> 0 ->> 'fr')
  from public.class_newsletters n where n.id = p_id;
$$;

create function tests.review_newsletter(p_week date)
returns uuid
language sql
as $$
  insert into public.class_newsletters (class_id, week_of, content)
  values (tests.id('class_a'), p_week, tests.review_content('Bonjour!'))
  returning id;
$$;

grant execute on function tests.review_content(text), tests.review_state(uuid),
  tests.review_newsletter(date) to authenticated;

select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select tests.remember('nl_sent', tests.review_newsletter('2026-10-05'))$$,
  'the teacher prepares a message'
);
select lives_ok(
  $$update public.class_newsletters set status = 'sent' where id = tests.id('nl_sent')$$,
  'and marks it sent'
);
select throws_ok(
  $$update public.class_newsletters set content = tests.review_content('Texte changé après l''envoi')
    where id = tests.id('nl_sent') and revision = 1$$,
  'LXN07', null,
  'a save from a tab opened before (same revision) cannot change a message marked sent'
);
select is(tests.review_state(tests.id('nl_sent')), 'sent r1 Bonjour!',
  'the message is unchanged: what went to families');
select throws_ok(
  $$update public.class_newsletters set content = tests.review_content('Autre'), status = 'sent'
    where id = tests.id('nl_sent')$$,
  'LXN07', null, 'nor can any change of its content while it stays sent'
);
select lives_ok(
  $$update public.class_newsletters set status = 'draft' where id = tests.id('nl_sent')$$,
  '« Remettre en brouillon »'
);
select lives_ok(
  $$update public.class_newsletters set content = tests.review_content('Bonjour à tous!')
    where id = tests.id('nl_sent')$$,
  'then the draft can be edited'
);
select is(tests.review_state(tests.id('nl_sent')), 'draft r2 Bonjour à tous!',
  'the change bumps the revision as before');
select lives_ok(
  $$update public.class_newsletters set content = tests.review_content('Bonne semaine!'),
      status = 'sent'
    where id = tests.id('nl_sent')$$,
  'a draft may be changed and marked sent in one go'
);
select tests.clear_authentication();

select * from finish();
rollback;
