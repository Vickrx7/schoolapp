-- Class mode demo (DECISIONS D-084, D-089). Written by hand; loaded after the demo library and
-- its links (config.toml `sql_paths`, tools/lite-stack/stack.sh `cmd_seed`), so Isabelle
-- Tremblay's 3e année has content on its « Mode classe » tab:
--   - « Résultats gardés »: one session of « Quiz : les nombres jusqu’à 1 000 »
--     (demo/quiz-nombres-1000) played by 12 devices in 4 teams, answers shown, ended 7 days
--     before the seed ran, with the class results kept (class counts only);
--   - « Lien de la classe »: the class link (a new random one at every seed).
-- The session is played through the real functions (start, join, answer, reveal, end), so the
-- kept aggregate has exactly the shape the app reads, and every answer and device is deleted by
-- the end as in class; only the dates are then moved back 7 days. The end is audited like any
-- other (actor: Isabelle, dated when the seed ran).

do $$
declare
  v_teacher constant uuid := 'd0000000-0000-4000-8000-000000000001';  -- Isabelle Tremblay
  v_class constant uuid := 'e0000000-0000-4000-8000-000000000003';    -- 3e année
  v_item constant uuid := '7bdc7066-9b8a-5125-8351-bf234b0b11d3';     -- demo/quiz-nombres-1000
  v_teams constant text[] := array['huards', 'castors', 'orignaux', 'ours'];
  v_session uuid;
  v_code text;
  v_token text;
  v_tokens text[] := '{}';
  v_questions jsonb;
  v_answers jsonb;
  v_q jsonb;
  v_entry jsonb;
  v_right boolean;
  v_response jsonb;
  v_ids jsonb;
  i integer;
  d integer;
begin
  if not exists (select 1 from public.library_items where id = v_item) then
    raise exception 'class mode demo: library item % not found (load 20_library_demo.sql first)', v_item;
  end if;

  -- The teacher functions run as Isabelle (her claims, as PostgREST would set them).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_teacher, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_teacher::text, true);

  select s.session_id, s.join_code into v_session, v_code
  from public.start_class_session(v_class, v_item, null, 'teams', 4::smallint, 'device') s;

  -- 12 class tablets join with the code and choose their team, 3 per team.
  for d in 1 .. 12 loop
    select j.token into v_token
    from class_portal.join(v_code, null,
      encode(extensions.digest('demo-class-device-' || d, 'sha256'), 'hex'),
      encode(extensions.digest('demo-class-network', 'sha256'), 'hex')) j;
    if v_token is null then
      raise exception 'class mode demo: device % could not join', d;
    end if;
    v_tokens := v_tokens || v_token;
    perform class_portal.set_team(v_token, v_teams[(d - 1) % 4 + 1]);
  end loop;

  select s.questions into v_questions from public.class_sessions s where s.id = v_session;
  select k.answers into v_answers from public.class_session_keys k where k.session_id = v_session;

  -- Every question: most devices right, some wrong, device 12 silent every other question.
  for i in 0 .. jsonb_array_length(v_questions) - 1 loop
    perform public.class_session_control(v_session, 'next',
      (select s.state_version from public.class_sessions s where s.id = v_session));
    v_q := v_questions -> i;
    v_entry := v_answers -> (v_q ->> 'id');
    for d in 1 .. 12 loop
      continue when d = 12 and i % 2 = 1;
      v_right := (d * 7 + i * 3) % 10 >= 3;
      v_response := case v_q ->> 'kind'
        when 'multiple_choice' then case
          when v_right and v_entry ? 'choiceIds' then jsonb_build_object('choiceIds', v_entry -> 'choiceIds')
          else jsonb_build_object('choiceIds', jsonb_build_array((
            select c ->> 'id' from jsonb_array_elements(v_q -> 'choices') c
            where not coalesce(v_entry -> 'choiceIds' ? (c ->> 'id'), false)
            limit 1)))
          end
        when 'true_false' then jsonb_build_object('value',
          case when v_entry ? 'value' then (v_entry ->> 'value')::boolean = v_right else v_right end)
        when 'matching' then case
          when v_right and v_entry ? 'pairs' then jsonb_build_object('pairs', v_entry -> 'pairs')
          else jsonb_build_object('pairs', (
            -- Each left item paired with the right item of the next left item: all wrong.
            select jsonb_object_agg(l.o ->> 'id', v_entry -> 'pairs' ->> (
              (v_q -> 'left') -> ((l.n::integer) % jsonb_array_length(v_q -> 'left')) ->> 'id'))
            from jsonb_array_elements(v_q -> 'left') with ordinality l (o, n)))
          end
        when 'ordering' then case
          when v_right and v_entry ? 'orderedIds' then jsonb_build_object('orderedIds', v_entry -> 'orderedIds')
          else jsonb_build_object('orderedIds', (
            select jsonb_agg(x.o ->> 'id' order by x.n desc)
            from jsonb_array_elements(v_q -> 'items') with ordinality x (o, n)))
          end
        -- Short answers are not scored (the default) and never stored.
        else jsonb_build_object('text', case when v_right then 'Je pense que oui.' else 'Je ne sais pas.' end)
      end;
      perform class_portal.answer(v_tokens[d], i::smallint, v_response);
    end loop;
    perform public.class_session_control(v_session, 'reveal',
      (select s.state_version from public.class_sessions s where s.id = v_session));
  end loop;
  perform public.class_session_control(v_session, 'leaderboard',
    (select s.state_version from public.class_sessions s where s.id = v_session));

  -- « Terminer la séance » with « Garder les résultats de la classe (sans noms) ».
  perform public.end_class_session(v_session, true);
  if (select count(*) from public.session_responses r where r.session_id = v_session) > 0 then
    raise exception 'class mode demo: answers were not deleted';
  end if;

  -- Seven days before the seed ran.
  update public.class_sessions
  set created_at = created_at - interval '7 days', expires_at = expires_at - interval '7 days',
    ended_at = ended_at - interval '7 days', joining_closes_at = joining_closes_at - interval '7 days'
  where id = v_session;
  update public.class_session_results
  set saved_at = saved_at - interval '7 days',
    aggregate = aggregate || jsonb_build_object(
      'startedAt', (aggregate ->> 'startedAt')::timestamptz - interval '7 days',
      'endedAt', (aggregate ->> 'endedAt')::timestamptz - interval '7 days')
  where session_id = v_session;

  -- « Lien de la classe ».
  perform public.class_mode_link(v_class);

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
