-- The post-MVP review, round A (2026-10-03).
--
-- « Info-parents » (DECISIONS D-136, D-137, as amended): a message marked « Envoyé » keeps the text
-- that went to families. A save from a tab opened before it was marked sent, a « Préremplir à
-- nouveau » or any other change of its content is refused (LXN07) until the teacher presses
-- « Remettre en brouillon »; marking it sent or back to a draft is unchanged. Before this, a stale
-- tab's « Enregistrer » could change a sent message while the list still said « Envoyé le … ».
--
-- Error code: LXN07 the message is marked sent (« Remettez-le en brouillon pour le modifier »).

create or replace function app.class_newsletters_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts date;
  v_ends date;
  v_purged timestamptz;
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null
       and new.class_id not in (select app.my_class_ids()) then
      return new;
    end if;
    select y.starts_on, y.ends_on, c.students_purged_at into v_starts, v_ends, v_purged
    from public.classes c left join public.school_years y on y.id = c.school_year_id
    where c.id = new.class_id;
    if v_purged is not null then
      raise exception 'the class''s students were purged' using errcode = 'LXN02';
    end if;
    -- A week that touches the year (its Friday on or after the first day, its Monday on or
    -- before the last).
    if v_starts is not null
       and (new.week_of + 4 < v_starts or new.week_of > v_ends) then
      raise exception 'the week lies outside the class''s school year' using errcode = 'LXN01';
    end if;
    new.revision := 1;
    new.status := 'draft';
    new.sent_at := null;
    new.created_by := app.active_user_id();
    new.updated_by := new.created_by;
    return new;
  end if;

  -- A message marked sent keeps its text: « Remettre en brouillon » first.
  if old.status = 'sent' and new.status = 'sent' and new.content is distinct from old.content then
    raise exception 'the message is marked sent' using errcode = 'LXN07';
  end if;
  if new.content is distinct from old.content then
    new.revision := old.revision + 1;
    new.updated_by := coalesce(app.active_user_id(), new.updated_by);
  else
    new.revision := old.revision;
  end if;
  if new.status is distinct from old.status then
    new.sent_at := case when new.status = 'sent' then now() end;
  end if;
  return new;
end;
$$;

revoke execute on function app.class_newsletters_before_write() from public, anon, authenticated;
