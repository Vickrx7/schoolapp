-- « Info-parents », slice S3: « Traduire en anglais (IA) » (DECISIONS D-139, amending D-038, D-052
-- and D-072). The AI writes the English of a message's French paragraphs; the answer is put back
-- on the paragraphs only while the message is unchanged. Modelled on 20261015090200_library_ai.sql
-- and 20270118090200_report_comments_ai.sql, with app.enqueue_ai_job (20261002100000_sub_plan_ai.sql).
--
--  1. The feature `newsletter_translate`, and an index to find a message's open request.
--  2. The request, built by the database from the stored message (D-072 style): the teacher sends
--     the message's id, the scope (`missing`: the paragraphs whose English is missing or out of
--     date; `all`: every paragraph), the revision she previewed and the keys of the paragraphs the
--     preview showed as sent. The paragraphs of the sections shown, in order, with their French
--     only, under keys P1…, and the class's grade labels: no class, school, staff name, signature
--     or id reaches the message (the paragraph ids stay here, to put the answer back). The
--     preview returns exactly this; the app then leaves out the paragraphs with a personal detail
--     or a title before a name it does not know, and the request keeps only the confirmed keys
--     (`sendKeys`), which the worker checks again (packages/ai newsletter-translate.ts).
--  3. Asking: the class team with a teacher role at a school with the Teaching module; the same
--     school switch, budget and limits per person as every AI request (app.enqueue_ai_job). A
--     second tap returns the requester's own open request; a colleague's open request refuses.
--  4. Applying the answer: inside the worker's own update that records a finished job. Each
--     answer goes on its paragraph if that paragraph's French is still the one sent (`en`,
--     `enFrom`, `enBy = 'ai'`), as the requester (`updated_by`); a message whose revision changed
--     since the request takes nothing (`newsletterChanged`).
--  5. Permissions.
--
-- Error codes: 42501 not allowed (not on the class team with a teacher role, a deactivated
-- account, no Teaching module); 22023 a request the app never sends (bad scope or keys, duplicate
-- paragraph ids, a message marked sent); LXN03 too large for the AI (over 60 paragraphs or 32 KB);
-- LXN04 nothing to translate; LXN05 the message changed since the preview; LXN06 a colleague's
-- translation of this message is running; LXA01 AI off, LXA02 budget reached, LXA03 too many
-- requests (app.enqueue_ai_job). A job whose message changed fails with 'newsletterChanged', one
-- whose message would grow past its size with 'newsletterTooLargeForAi', an unusable answer with
-- 'invalidOutput'. No new audit action (D-103): AI usage goes to ai_generations (D-104).
-- Tests: supabase/tests/37_class_newsletters_ai.test.sql;
-- apps/worker/src/newsletter-ai.int.test.ts.

-- ---------------------------------------------------------------------------------------
-- 1. The feature. request_ai_job keeps its list (« Texte différencié » only): a translation
--    comes only through the functions below, which build their input themselves.
-- ---------------------------------------------------------------------------------------

alter table public.ai_jobs drop constraint ai_jobs_feature_check,
  add constraint ai_jobs_feature_check
    check (feature in ('differentiate', 'sub_plan', 'library_item', 'library_levels',
      'report_comment_bank', 'newsletter_translate'));

-- A message's open request (LXN06, and a second tap).
create index ai_jobs_newsletter_open_idx on public.ai_jobs (((input ->> 'newsletterId')))
  where feature = 'newsletter_translate' and status in ('queued', 'running');

-- ---------------------------------------------------------------------------------------
-- 2. Building the request
-- ---------------------------------------------------------------------------------------

-- A paragraph's text as @lynx/domain `sameFrench` compares it: runs of spaces (JavaScript's \s,
-- no-break spaces included) as one space, typographic and other apostrophes as ', trimmed.
create function app.newsletter_text_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(translate(coalesce(p_text, ''), '’`´', ''''''''),
    E'[\\t\\n\\v\\f\\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'),
    ' ');
$$;

-- The input of « Traduire en anglais (IA) » for one message (D-139). Checks, in order: the user
-- (an active account on the class's team, with a teacher role at the class's school, which has
-- the Teaching module; else 42501), the scope (`missing` or `all`), a message still in draft,
-- distinct well-formed paragraph ids (22023); then the paragraphs of the sections not removed, in
-- order, with a French text: for `missing`, those whose English is empty or was written for
-- another French (« à écrire », « à mettre à jour »). None: LXN04; more than 60, a French over
-- 1,000 characters or more than 32 KB in all: LXN03. Returns {newsletterId, revision, scope,
-- gradeLabels, items: [{key, itemId, section, text}], sendKeys: null}. Service role only: it
-- takes a user.
create function app.newsletter_ai_input(p_user uuid, p_newsletter_id uuid, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.class_newsletters;
  v_school uuid;
  v_items jsonb;
  v_count integer;
  v_grades jsonb;
begin
  -- 1. Who: the class team with a teacher role (as app.my_class_ids()), Teaching module.
  select * into v_row from public.class_newsletters n where n.id = p_newsletter_id;
  select c.school_id into v_school from public.classes c where c.id = v_row.class_id;
  if p_user is null or v_row.id is null
    or not exists (
      select 1
      from public.class_teachers ct
      join public.users u on u.id = ct.user_id and u.deactivated_at is null
      join public.user_roles ur on ur.user_id = ct.user_id and ur.school_id = v_school
        and ur.role = 'teacher'
      where ct.class_id = v_row.class_id and ct.user_id = p_user)
    or not app.school_has_module(v_school, 'teaching')
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- 2. The scope; a message marked sent is read-only in the app.
  if p_scope is null or p_scope not in ('missing', 'all') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'the message was marked sent' using errcode = '22023';
  end if;
  if jsonb_typeof(v_row.content -> 'sections') is distinct from 'array' then
    raise exception 'unreadable message' using errcode = '22023';
  end if;

  -- 3. Every paragraph's id once, as the app writes them.
  if exists (
    select 1
    from jsonb_array_elements(v_row.content -> 'sections') s,
      jsonb_array_elements(app.jsonb_array_or_empty(s -> 'items')) i
    where coalesce(i ->> 'id', '') !~ '^[a-z0-9]{8}$'
  ) or (
    select count(*) <> count(distinct i ->> 'id')
    from jsonb_array_elements(v_row.content -> 'sections') s,
      jsonb_array_elements(app.jsonb_array_or_empty(s -> 'items')) i
  ) then
    raise exception 'invalid paragraph ids' using errcode = '22023';
  end if;

  -- 4. The paragraphs to translate, in the message's order.
  with paragraphs as (
    select s.value ->> 'key' as section, s.n as sn, i.value as item, i.m as inum
    from jsonb_array_elements(v_row.content -> 'sections') with ordinality s (value, n),
      jsonb_array_elements(app.jsonb_array_or_empty(s.value -> 'items')) with ordinality i (value, m)
    where jsonb_typeof(s.value) = 'object'
      and s.value ->> 'key' in ('message', 'thisWeek', 'nextWeek', 'dates', 'reminders', 'atHome',
        'faith', 'closing')
      and s.value -> 'off' is distinct from 'true'::jsonb
      and app.newsletter_text_key(i.value ->> 'fr') <> ''
      and (
        p_scope = 'all'
        or app.newsletter_text_key(i.value ->> 'en') = ''
        or (jsonb_typeof(i.value -> 'enFrom') = 'string'
            and app.newsletter_text_key(i.value ->> 'enFrom')
                <> app.newsletter_text_key(i.value ->> 'fr'))
      )
  ),
  numbered as (
    select p.*, row_number() over (order by p.sn, p.inum) as k from paragraphs p
  )
  select count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'key', 'P' || k,
      'itemId', item ->> 'id',
      'section', section,
      'text', item ->> 'fr') order by k), '[]'::jsonb)
  into v_count, v_items
  from numbered;

  if v_count = 0 then
    raise exception 'nothing to translate' using errcode = 'LXN04';
  end if;
  if v_count > 60 or pg_column_size(v_items) > 32768
    or exists (
      select 1 from jsonb_array_elements(v_items) i where char_length(i ->> 'text') > 1000)
  then
    raise exception 'too large for the AI' using errcode = 'LXN03';
  end if;

  -- 5. The class's grades (« 3e année »), at most four.
  select coalesce(jsonb_agg(g.label_fr order by g.ordinal), '[]'::jsonb) into v_grades
  from (
    select gr.label_fr, gr.ordinal
    from public.class_grades cg join public.grades gr on gr.code = cg.grade_code
    where cg.class_id = v_row.class_id
    order by gr.ordinal
    limit 4
  ) g;

  return jsonb_build_object(
    'newsletterId', v_row.id,
    'revision', v_row.revision,
    'scope', p_scope,
    'gradeLabels', v_grades,
    'items', v_items,
    'sendKeys', null
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Preview and request (never automatic, always previewed)
-- ---------------------------------------------------------------------------------------

create function public.newsletter_ai_preview(p_newsletter_id uuid, p_scope text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.newsletter_ai_input(app.active_user_id(), p_newsletter_id, p_scope);
$$;

-- « Envoyer à l'IA »: the request for the revision the teacher previewed (else LXN05), with the
-- keys of the paragraphs the preview showed as sent (at least one, each a paragraph of the
-- request, each once; else 22023), kept in the message's order. The requester's own open request
-- for this message is returned (a second tap); a colleague's refuses (LXN06). The message's row
-- is locked first, so two requests for one message wait for each other.
create function public.request_newsletter_translation(
  p_newsletter_id uuid,
  p_scope text,
  p_expected_revision integer,
  p_send_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.active_user_id();
  v_input jsonb;
  v_school uuid;
  v_open public.ai_jobs;
  v_keys jsonb;
begin
  -- Who may ask (42501), before anything is locked.
  perform app.newsletter_ai_input(v_user, p_newsletter_id, p_scope);
  perform 1 from public.class_newsletters n where n.id = p_newsletter_id for update;
  v_input := app.newsletter_ai_input(v_user, p_newsletter_id, p_scope);
  if p_expected_revision is null or (v_input ->> 'revision')::integer <> p_expected_revision then
    raise exception 'the message changed since the preview' using errcode = 'LXN05';
  end if;

  if p_send_keys is null or cardinality(p_send_keys) = 0
    or cardinality(p_send_keys) <> (select count(distinct k) from unnest(p_send_keys) k)
    or exists (
      select 1 from unnest(p_send_keys) k
      where not exists (
        select 1 from jsonb_array_elements(v_input -> 'items') i where i ->> 'key' = k))
  then
    raise exception 'invalid paragraphs' using errcode = '22023';
  end if;
  select jsonb_agg(i ->> 'key' order by n) into v_keys
  from jsonb_array_elements(v_input -> 'items') with ordinality t (i, n)
  where i ->> 'key' = any (p_send_keys);
  v_input := jsonb_set(v_input, '{sendKeys}', v_keys);

  select * into v_open from public.ai_jobs j
  where j.feature = 'newsletter_translate' and j.status in ('queued', 'running')
    and j.input ->> 'newsletterId' = p_newsletter_id::text
  order by j.created_at desc
  limit 1;
  if v_open.id is not null then
    if v_open.user_id = v_user then
      return v_open.id;
    end if;
    raise exception 'a colleague''s translation is running' using errcode = 'LXN06';
  end if;

  select c.school_id into v_school
  from public.class_newsletters n join public.classes c on c.id = n.class_id
  where n.id = p_newsletter_id;
  return app.enqueue_ai_job(v_user, v_school, 'newsletter_translate', v_input, 65536);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Applying the answer (D-139). The worker records a succeeded job with one update
--    (apps/worker/src/ai.ts finishJob); this trigger runs inside it.
-- ---------------------------------------------------------------------------------------

-- Puts each answer `{key, text}` on its paragraph (the key's `itemId` in the job's input), if the
-- key was sent (`sendKeys`) and the paragraph's French is still the one sent: `en` (trimmed, at
-- most 1,500 characters), `enFrom` (that French), `enBy = 'ai'`; nothing else changes. Written as
-- the requester (`updated_by`, through app.class_newsletters_before_write), which bumps the
-- revision. Returns the number of paragraphs written; null when the message is gone, marked sent
-- or changed since the request (its revision); -1 when it would grow past what the app reads
-- (60,000 bytes). Raises when the answer cannot be read.
create function app.newsletter_translation_from_job(p_job public.ai_jobs)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.class_newsletters;
  v_answers jsonb;
  v_content jsonb;
  v_applied integer;
begin
  if jsonb_typeof(p_job.result) is distinct from 'object'
    or jsonb_typeof(p_job.result -> 'items') is distinct from 'array'
    or jsonb_typeof(p_job.input -> 'items') is distinct from 'array'
  then
    raise exception 'unusable answer' using errcode = '22023';
  end if;
  select * into v_row from public.class_newsletters n
  where n.id = (p_job.input ->> 'newsletterId')::uuid
  for update;
  if v_row.id is null or v_row.status <> 'draft'
    or v_row.revision <> (p_job.input ->> 'revision')::integer
    or jsonb_typeof(v_row.content -> 'sections') is distinct from 'array'
  then
    return null;
  end if;

  -- The answers by paragraph id, with the French they were written for: sent keys only, each
  -- answered once (the first answer of a key), never empty.
  select coalesce(jsonb_object_agg(i ->> 'itemId',
      jsonb_build_object('fr', i ->> 'text', 'en', left(btrim(a.text), 1500))), '{}'::jsonb)
  into v_answers
  from jsonb_array_elements(p_job.input -> 'items') i
  cross join lateral (
    select r ->> 'text' as text
    from jsonb_array_elements(p_job.result -> 'items') with ordinality x (r, n)
    where jsonb_typeof(r) = 'object' and r ->> 'key' = i ->> 'key'
    order by n
    limit 1
  ) a
  where nullif(btrim(coalesce(a.text, '')), '') is not null
    and (jsonb_typeof(p_job.input -> 'sendKeys') is distinct from 'array'
         or (p_job.input -> 'sendKeys') ? (i ->> 'key'));

  select count(*) into v_applied
  from jsonb_array_elements(v_row.content -> 'sections') s,
    jsonb_array_elements(app.jsonb_array_or_empty(s -> 'items')) it
  where v_answers ? (it ->> 'id') and it ->> 'fr' = v_answers -> (it ->> 'id') ->> 'fr';
  if v_applied = 0 then
    return 0;
  end if;

  select jsonb_agg(
      case when jsonb_typeof(s) = 'object' and jsonb_typeof(s -> 'items') = 'array' then
        jsonb_set(s, '{items}', (
          select coalesce(jsonb_agg(
              case when v_answers ? (it ->> 'id')
                    and it ->> 'fr' = v_answers -> (it ->> 'id') ->> 'fr'
                then it || jsonb_build_object(
                  'en', v_answers -> (it ->> 'id') -> 'en',
                  'enFrom', it -> 'fr',
                  'enBy', 'ai')
                else it
              end order by n), '[]'::jsonb)
          from jsonb_array_elements(s -> 'items') with ordinality x (it, n)))
      else s
      end order by sn)
  into v_content
  from jsonb_array_elements(v_row.content -> 'sections') with ordinality y (s, sn);

  v_content := jsonb_set(v_row.content, '{sections}', v_content);
  -- The app reads at most 60,000 bytes of compact JSON (@lynx/domain NEWSLETTER_LIMITS): the
  -- database's text form is never shorter.
  if octet_length(v_content::text) > 60000 then
    return -1;
  end if;
  update public.class_newsletters n
  set content = v_content, updated_by = p_job.user_id
  where n.id = v_row.id;
  return v_applied;
end;
$$;

-- The job's result keeps the answer and gains the message and the number of paragraphs written
-- (`newsletterId`, `applied`). A failure keeps nothing.
create function app.ai_jobs_apply_newsletter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied integer;
begin
  begin
    v_applied := app.newsletter_translation_from_job(new);
    if v_applied is null then
      new.status := 'failed';
      new.error_code := 'newsletterChanged';
      new.result := null;
    elsif v_applied < 0 then
      new.status := 'failed';
      new.error_code := 'newsletterTooLargeForAi';
      new.result := null;
    else
      new.result := new.result || jsonb_build_object(
        'newsletterId', new.input ->> 'newsletterId', 'applied', v_applied);
    end if;
  exception when others then
    -- The code only: an error message could quote the answer.
    raise warning 'newsletter translation not stored (job %, %)', new.id, sqlstate;
    new.status := 'failed';
    new.error_code := 'invalidOutput';
    new.result := null;
  end;
  return new;
end;
$$;

create trigger ai_jobs_apply_newsletter before update of status on public.ai_jobs
  for each row
  when (new.feature = 'newsletter_translate' and new.status = 'succeeded'
        and old.status is distinct from 'succeeded')
  execute function app.ai_jobs_apply_newsletter();

-- ---------------------------------------------------------------------------------------
-- 5. Permissions: functions are opt-in, as everywhere else (named one by one: anon keeps the
--    sign-in throttle, D-121).
-- ---------------------------------------------------------------------------------------

revoke execute on function
  app.newsletter_text_key(text),
  app.newsletter_ai_input(uuid, uuid, text),
  public.newsletter_ai_preview(uuid, text),
  public.request_newsletter_translation(uuid, text, integer, text[]),
  app.newsletter_translation_from_job(public.ai_jobs),
  app.ai_jobs_apply_newsletter()
from public, anon;

grant execute on function
  public.newsletter_ai_preview(uuid, text),
  public.request_newsletter_translation(uuid, text, integer, text[])
to authenticated;
-- The input builder takes a user: the operator and tests only (service role). The text key and
-- the trigger's helpers are reached only through these functions: no grants.
grant execute on function app.newsletter_ai_input(uuid, uuid, text) to service_role;
