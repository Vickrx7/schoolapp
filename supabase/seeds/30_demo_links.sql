-- Links between the demo library (20_library_demo.sql) and the demo planning (seed.sql).
-- Written by hand; loaded after both (config.toml `sql_paths`, tools/lite-stack/stack.sh).
--
-- 3e année, Mathématiques, lesson 5 « Ordonner des nombres » uses the board-approved worksheet
-- « Ordonner des nombres jusqu'à 1 000 » (demo/ordonner-nombres-1000, UUIDv5 under the content
-- namespace; DECISIONS D-071, D-076). The link counts one unit in the item's usage_count.

do $$
declare
  v_item uuid := '191569be-69c6-5fc4-beeb-b9fd92bb45c8';  -- demo/ordonner-nombres-1000
  v_count integer;
begin
  if not exists (select 1 from public.library_items where id = v_item) then
    raise exception 'demo links: library item % not found (load 20_library_demo.sql first)', v_item;
  end if;
  update public.unit_lessons set library_item_id = v_item
  where unit_id = '30000000-0000-4000-8000-000000000302' and sequence_number = 5;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'demo links: 3e MAT lesson 5 not found';
  end if;
end;
$$;
