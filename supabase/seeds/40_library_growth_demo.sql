-- Library growth demo (DECISIONS D-092, D-093). Written by hand; loaded after the demo library
-- and its links (config.toml `sql_paths`, tools/lite-stack/stack.sh `cmd_seed`):
--   - « Votre avis »: two opinions on the board-approved « Le huard, oiseau des lacs »
--     (demo/huard-oiseau-des-lacs), Marc Gagnon 5 stars and Paul Leblanc 4, so its page shows
--     « 2 avis : pas encore assez pour une moyenne » (an average shows from 5 opinions);
--   - « Adapter »: Marc's adaptation of the board's « La moyenne, la médiane et le mode »
--     (demo/moyenne-mediane-mode), a private draft in his « Mes ressources » with the credit line
--     « Adaptée de « La moyenne, la médiane et le mode » ».
-- Both go through the real functions (rate_library_item, remix_library_item) as each teacher, so
-- the demo holds only what the app itself could have written; the adaptation is audited like any
-- other (actor: Marc). Loading it again changes nothing: the copy's id is fixed and opinions are
-- one per person.

do $$
declare
  v_marc constant uuid := 'd0000000-0000-4000-8000-000000000002';   -- Marc Gagnon, 5e année
  v_paul constant uuid := 'd0000000-0000-4000-8000-000000000003';   -- Paul Leblanc
  v_huard constant uuid := '3daed963-c2a5-568d-b23e-b38865b2b551';  -- demo/huard-oiseau-des-lacs
  v_mean constant uuid := '61a7a7bc-a2e2-5abd-a700-3db3b79bd26e';   -- demo/moyenne-mediane-mode
  v_copy constant uuid := '40000000-0000-4000-8000-000000000001';   -- Marc's adaptation
begin
  if not exists (select 1 from public.library_items where id = v_huard)
    or not exists (select 1 from public.library_items where id = v_mean)
  then
    raise exception 'library growth demo: demo library items not found (load 20_library_demo.sql first)';
  end if;

  -- Each teacher's claims, as PostgREST would set them.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_marc, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_marc::text, true);
  perform public.rate_library_item(v_huard, 5::smallint);
  if public.remix_library_item(v_mean, v_copy) <> v_copy then
    raise exception 'library growth demo: the adaptation was not made';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_paul, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_paul::text, true);
  perform public.rate_library_item(v_huard, 4::smallint);

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
