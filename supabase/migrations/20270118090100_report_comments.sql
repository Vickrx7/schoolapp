-- « Commentaires de bulletin », slice S1: comment banks (« Banque de commentaires de bulletin »)
-- as library type 26, `report_comments` (DECISIONS D-129, D-131; amends D-061, D-067, D-076,
-- D-077, D-082, D-094 and D-100). The enum value comes from 20270118090000_report_comments_type.sql.
-- Tests: supabase/tests/35_report_comments.test.sql
--
-- A bank holds report card comment phrases with the placeholder {prénom} and no student data. It
-- is library content like any other (sharing with the first-name check, approval, faith review
-- for Enseignement religieux, search, packs, « Adapter »), but it is not teaching material:
-- 1. `app.library_bucket_for`: « Évaluer ».
-- 2. `app.library_type_levelable` (no versions per level) and
--    `app.library_type_never_sub_friendly` (never for a substitute).
-- 3. Constraints: never sub-friendly (D-077), never projectable or interactive, so the
--    projector and class mode never offer it (`isPresentable`, D-082).
-- 4. `app.library_type_terms`: what teachers call it, so « bulletin » finds it.
-- 5. `app.library_content_text`: the entries' machine values (scope, period, skill, progress,
--    rating, expectationCodes) are not indexed.
-- 6. `app.library_assert_ready` (D-067): no duration or materials; attentes optional (a bank of
--    « commentaires généraux » when no curriculum is loaded, D-030); a subject except for a
--    learning-skills bank (the base version's `scope`). The finer rules are the app's
--    (`reviewReadiness`: the scope matches the subject, `ere` for religion).
-- 7. `app.unit_lessons_before_write`: a lesson never links a bank (LXK01), which also covers
--    `add_library_item_to_unit`. Class sessions already refuse every type but quizzes and games.
-- 8. `app.library_item_ai_input_for_board`: « Créer avec l'IA » and bulk generation refuse the
--    type (22023): banks have their own request (slice S2, D-132).
-- 9. Content packs (D-100): a learning-skills bank has no subject, so the export keeps items
--    without one (subjectCode null) and the import accepts a null subject for such a bank only.
-- 10. `app.library_coverage_rows` (D-094): a bank never counts as a resource for an attente.
-- No new table, event or audit action: the bank workflow uses the library's (D-079).
--
-- Error codes: LXK01 a comment bank is not teaching material (never in a lesson).

-- ---------------------------------------------------------------------------------------
-- 1. The bucket. Immutable, it feeds the stored generated column `library_items.bucket`; no
--    row of the new type exists yet, and replacing it keeps its grants.
-- ---------------------------------------------------------------------------------------

create or replace function app.library_bucket_for(p_type public.library_item_type)
returns public.library_bucket
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('lesson_plan', 'anchor_chart', 'worked_example', 'teacher_guide')
      then 'enseigner'::public.library_bucket
    when p_type in ('worksheet', 'learning_centre', 'reading_passage', 'vocabulary_bank', 'exit_ticket')
      then 'pratiquer'::public.library_bucket
    when p_type in ('experiment', 'stem_challenge', 'project', 'outdoor_activity')
      then 'explorer'::public.library_bucket
    when p_type in ('quiz', 'unit_test', 'diagnostic', 'rubric', 'report_comments')
      then 'evaluer'::public.library_bucket
    when p_type in ('game', 'brain_break', 'song', 'riddle', 'weekly_challenge')
      then 'jouer'::public.library_bucket
    else 'relier'::public.library_bucket
  end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. The type's flags for the AI requests (20261015090200_library_ai.sql)
-- ---------------------------------------------------------------------------------------

create or replace function app.library_type_levelable(p_type public.library_item_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type not in ('lesson_plan', 'teacher_guide', 'rubric', 'report_comments', 'brain_break',
    'song', 'parent_guide');
$$;

-- Types that are never used by a substitute (the library_items_sub_friendly_allowed check).
create or replace function app.library_type_never_sub_friendly(p_type public.library_item_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('unit_test', 'diagnostic', 'rubric', 'report_comments', 'parent_guide',
    'teacher_guide', 'project');
$$;

-- ---------------------------------------------------------------------------------------
-- 3. Never for a substitute (D-077), never on the projector or in class mode (D-082)
-- ---------------------------------------------------------------------------------------

alter table public.library_items
  drop constraint library_items_sub_friendly_allowed,
  add constraint library_items_sub_friendly_allowed check (not sub_friendly or (
    type not in ('unit_test', 'diagnostic', 'rubric', 'report_comments', 'parent_guide',
      'teacher_guide', 'project')
    and (type not in ('experiment', 'stem_challenge') or safety_notes ->> 'supervision' = 'standard'))),
  add constraint library_items_report_comments_formats
    check (type <> 'report_comments' or (not is_projectable and not is_interactive));

-- ---------------------------------------------------------------------------------------
-- 4 and 5. Search (D-068)
-- ---------------------------------------------------------------------------------------

-- What teachers call each type, so « billet de sortie » or « défi STIM » finds it.
create or replace function app.library_type_terms(p_type public.library_item_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'lesson_plan' then 'plan de leçon planification déroulement'
    when 'anchor_chart' then 'référentiel affiche aide-mémoire tableau d''ancrage'
    when 'worked_example' then 'exemple résolu démarche modèle'
    when 'teacher_guide' then 'guide pédagogique enseignement idées fausses conceptions erronées'
    when 'worksheet' then 'fiche d''exercices feuille d''exercices pratique'
    when 'learning_centre' then 'centre d''apprentissage atelier'
    when 'reading_passage' then 'texte de lecture compréhension'
    when 'vocabulary_bank' then 'banque de mots vocabulaire lexique'
    when 'exit_ticket' then 'billet de sortie vérification rapide'
    when 'experiment' then 'expérience sciences enquête scientifique'
    when 'stem_challenge' then 'défi stim sciences technologie ingénierie mathématiques design'
    when 'project' then 'projet'
    when 'outdoor_activity' then 'activité extérieure plein air dehors cour'
    when 'quiz' then 'quiz questionnaire'
    when 'unit_test' then 'évaluation de fin d''unité examen sommative'
    when 'diagnostic' then 'évaluation diagnostique acquis préalables'
    when 'rubric' then 'grille d''évaluation critères grille de correction'
    when 'report_comments' then 'banque de commentaires bulletin points forts prochaines étapes habiletés d''apprentissage habitudes de travail'
    when 'game' then 'jeu ludique'
    when 'brain_break' then 'pause active mouvement bouger'
    when 'song' then 'chanson comptine musique'
    when 'riddle' then 'devinettes énigmes charades'
    when 'weekly_challenge' then 'défi de la semaine problème'
    when 'catholic_reflection' then 'réflexion catholique foi prière'
    when 'culture_hook' then 'amorce culturelle francophonie culture franco-ontarienne'
    when 'parent_guide' then 'guide pour les familles parents maison'
  end;
$$;

-- Every string of a version's content, without machine keys (ids, kinds, enumerated values; a
-- comment bank's scope, period, skill, progress mark, rating and attente codes).
create or replace function app.library_content_text(p_content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with recursive walk (k, v) as (
    select null::text, p_content
    union all
    select c.k, c.v
    from walk w
    cross join lateral (
      select e.key, e.value
      from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select w.k, a.value
      from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) c (k, v)
  )
  select coalesce(string_agg(v #>> '{}', ' '), '')
  from walk
  where jsonb_typeof(v) = 'string'
    and coalesce(k, '') not in ('id', 'kind', 'questionId', 'category', 'space', 'stage',
      'supervision', 'wordClass', 'gender', 'schema', 'scope', 'period', 'skill', 'progress',
      'rating', 'expectationCodes');
$$;

-- ---------------------------------------------------------------------------------------
-- 6. Readiness (D-067)
-- ---------------------------------------------------------------------------------------

-- What an item needs to be marked reviewed, or approved (D-067). The content schema and the
-- completeness of answer keys are checked by the app (@lynx/content reviewReadiness): SQL
-- cannot run them. A comment bank (D-129) needs no duration, materials or attentes, and no
-- subject when it is about the learning skills (its base version's `scope`).
create or replace function app.library_assert_ready(p_item_id uuid, p_for_approval boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.library_items;
  v_missing text;
  v_scope text;
begin
  select * into i from public.library_items where id = p_item_id;
  if i.type = 'report_comments' then
    select v.content ->> 'scope' into v_scope
    from public.library_item_versions v
    where v.item_id = i.id and v.language_level_id is null;
  end if;
  v_missing := case
    when not exists (select 1 from public.library_item_grades g where g.item_id = i.id) then 'grades'
    when i.subject_id is null
      and not (i.type = 'report_comments' and v_scope is not distinct from 'learning_skills')
      then 'subject'
    when i.duration_minutes is null and i.type <> 'report_comments' then 'duration'
    when nullif(btrim(i.materials), '') is null and i.type <> 'report_comments' then 'materials'
    when nullif(btrim(i.keywords), '') is null
      and not exists (select 1 from public.library_item_tags t where t.item_id = i.id) then 'tags'
    when not exists (
      select 1 from public.library_item_versions v
      where v.item_id = i.id and v.language_level_id is null
    ) then 'base'
    when i.type not in ('brain_break', 'catholic_reflection', 'culture_hook', 'song', 'report_comments')
      and not exists (select 1 from public.library_item_expectations e where e.item_id = i.id)
      then 'expectations'
    when i.type in ('quiz', 'unit_test', 'diagnostic', 'exit_ticket', 'riddle') and not exists (
      select 1
      from public.library_item_versions v
      join public.library_item_answer_keys k on k.version_id = v.id
      where v.item_id = i.id and v.language_level_id is null
    ) then 'key'
    when p_for_approval and i.type in ('reading_passage', 'worksheet', 'exit_ticket', 'quiz')
      and exists (
        select 1 from public.language_levels ll
        where ll.board_id = i.board_id and ll.owner_user_id is null and ll.active
          and not exists (
            select 1 from public.library_item_versions v
            where v.item_id = i.id and v.language_level_id = ll.id
          )
      ) then 'levels'
  end;
  if v_missing is not null then
    raise exception 'not ready' using errcode = 'LXL01', detail = v_missing;
  end if;
  if i.type in ('experiment', 'stem_challenge') and not app.library_safety_notes_valid(i.safety_notes) then
    raise exception 'safety notes required' using errcode = 'LXL02';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Never in a lesson (D-076): a bank is not teaching material
-- ---------------------------------------------------------------------------------------

create or replace function app.unit_lessons_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  elsif new.unit_id <> old.unit_id then
    raise exception 'a lesson cannot move to another unit' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.library_item_id is distinct from old.library_item_id then
    perform app.assert_library_item_readable(new.library_item_id);
    if new.library_item_id is not null and exists (
      select 1 from public.library_items i
      where i.id = new.library_item_id and i.type = 'report_comments'
    ) then
      raise exception 'a comment bank is not teaching material' using errcode = 'LXK01';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 8. « Créer avec l'IA » and bulk generation (D-072, D-095): not for comment banks. Copied
--    whole from 20261101090300_library_bulk.sql, with the check after step 2.
-- ---------------------------------------------------------------------------------------

-- The input of « Créer avec l'IA » for a board (D-072), checks 2 to 9 of
-- app.library_item_ai_input: the request's shape (22023), the type (22P02 when it is not one; a
-- comment bank: 22023), then every choice (22023). Labels, attente texts, level descriptions and
-- the reference come from the tables. With `p_user` null (bulk generation, D-095) only the
-- board's own levels are allowed. Service role only.
create or replace function app.library_item_ai_input_for_board(p_board_id uuid, p_user uuid, p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board uuid := p_board_id;
  v_type public.library_item_type;
  v_grades text[];
  v_grade_labels jsonb;
  v_min_ordinal smallint;
  v_max_ordinal smallint;
  v_subject public.subjects;
  v_exp_ids uuid[];
  v_expectations jsonb;
  v_strand text;
  v_level_ids uuid[];
  v_levels jsonb;
  v_ref public.catholic_references;
  v_duration numeric;
  v_sub boolean;
  v_note text;
begin
  if v_board is null or not exists (select 1 from public.boards b where b.id = v_board) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or coalesce(jsonb_typeof(p_request -> 'gradeCodes'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_request -> 'expectationIds'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_request -> 'levelIds'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(p_request -> 'durationMinutes'), 'null') <> 'number'
    or coalesce(jsonb_typeof(p_request -> 'subFriendly'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(p_request -> 'teacherNote'), 'null') not in ('string', 'null')
    or nullif(p_request ->> 'itemType', '') is null
  then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  -- 2. The type (an unknown one raises 22P02).
  v_type := (p_request ->> 'itemType')::public.library_item_type;
  -- A comment bank has its own request (« Créer une banque avec l'IA », D-132): never this one,
  -- nor bulk generation (D-129).
  if v_type = 'report_comments' then
    raise exception 'comment banks have their own request' using errcode = '22023';
  end if;

  -- 3. One or two existing grades.
  v_grades := array(select distinct x from jsonb_array_elements_text(p_request -> 'gradeCodes') x);
  if cardinality(v_grades) not between 1 and 2
    or cardinality(v_grades) <> jsonb_array_length(p_request -> 'gradeCodes')
    or (select count(*) from public.grades g where g.code = any (v_grades)) <> cardinality(v_grades)
  then
    raise exception 'invalid grades' using errcode = '22023';
  end if;
  -- In grade order, with their French labels (the content is French).
  select array_agg(g.code order by g.ordinal), jsonb_agg(g.label_fr order by g.ordinal),
    min(g.ordinal), max(g.ordinal)
  into v_grades, v_grade_labels, v_min_ordinal, v_max_ordinal
  from public.grades g where g.code = any (v_grades);

  -- 4. An active subject, standard or the board's, taught in those grades.
  select * into v_subject from public.subjects s
  where s.id = nullif(p_request ->> 'subjectId', '')::uuid and s.active
    and (s.board_id is null or s.board_id = v_board)
    and s.grade_min <= v_min_ordinal and s.grade_max >= v_max_ordinal;
  if v_subject.id is null then
    raise exception 'invalid subject' using errcode = '22023';
  end if;

  -- 5. Up to five attentes of that subject and those grades, in the order chosen (E1…); at
  --    least one, except for the types that may have none (D-067).
  v_exp_ids := array(
    select x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_request -> 'expectationIds'))
      with ordinality t (x, n) order by n);
  if cardinality(v_exp_ids) > 5
    or (select count(distinct x) from unnest(v_exp_ids) x) <> cardinality(v_exp_ids)
    or (cardinality(v_exp_ids) = 0
      and v_type not in ('brain_break', 'catholic_reflection', 'culture_hook', 'song'))
    or exists (
      select 1 from unnest(v_exp_ids) e
      where not exists (
        select 1 from public.curriculum_expectations ce
        where ce.id = e and ce.subject_id = v_subject.id and ce.grade_code = any (v_grades)))
  then
    raise exception 'invalid attentes' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', 'E' || t.n, 'expectationId', ce.id, 'code', ce.code, 'text', ce.text_fr) order by t.n),
    '[]'::jsonb)
  into v_expectations
  from unnest(v_exp_ids) with ordinality t (id, n)
  join public.curriculum_expectations ce on ce.id = t.id;
  select st.label_fr into v_strand
  from public.curriculum_expectations ce
  join public.strands st on st.id = ce.strand_id
  where ce.id = v_exp_ids[1];

  -- 6. Levels, only for types that have them (the board's, and the user's own when there is one).
  v_level_ids := array(
    select x::uuid from jsonb_array_elements_text(app.jsonb_array_or_empty(p_request -> 'levelIds')) x);
  if cardinality(v_level_ids) > 0 and not app.library_type_levelable(v_type) then
    raise exception 'this type has no levels' using errcode = '22023';
  end if;
  v_levels := app.library_ai_levels(p_user, v_board, v_level_ids, 0);

  -- 7. The Catholic reference: global or the board's, active; required for a reflection.
  if nullif(p_request ->> 'catholicReferenceId', '') is not null then
    select * into v_ref from public.catholic_references r
    where r.id = (p_request ->> 'catholicReferenceId')::uuid and r.active
      and (r.board_id is null or r.board_id = v_board);
    if v_ref.id is null then
      raise exception 'invalid Catholic reference' using errcode = '22023';
    end if;
  elsif v_type = 'catholic_reflection' then
    raise exception 'a reflection needs a Catholic reference' using errcode = '22023';
  end if;

  -- 8. For a substitute: never assessments, rubrics, guides and projects.
  v_sub := coalesce((p_request ->> 'subFriendly')::boolean, false);
  if v_sub and app.library_type_never_sub_friendly(v_type) then
    raise exception 'never for a substitute' using errcode = '22023';
  end if;

  -- 9. Duration and the note.
  v_duration := (p_request ->> 'durationMinutes')::numeric;
  v_note := btrim(coalesce(p_request ->> 'teacherNote', ''));
  if v_duration not between 5 and 240 or v_duration <> trunc(v_duration)
    or char_length(v_note) > 1000
  then
    raise exception 'invalid duration or note' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'itemType', v_type,
    'gradeCodes', to_jsonb(v_grades),
    'gradeLabels', v_grade_labels,
    'subjectId', v_subject.id,
    'subjectLabel', v_subject.label_fr,
    'strandLabel', v_strand,
    'expectations', v_expectations,
    'levels', v_levels,
    'catholic', case when v_ref.id is not null then jsonb_build_object(
      'key', 'R1', 'referenceId', v_ref.id, 'type', v_ref.type, 'title', v_ref.title,
      'text', v_ref.text_fr) end,
    'durationMinutes', v_duration::integer,
    'subFriendly', v_sub,
    'teacherNote', v_note
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 9. Content packs (D-099, D-100): a learning-skills comment bank has no subject. Copied whole
--    from 20261101090400_content_packs.sql and 20261101090500_phase5_review_fixes.sql.
-- ---------------------------------------------------------------------------------------

-- One item as the CLI turns it into a pack item. Its key: the item's key in the pack being
-- exported again (same slug), else its id, so two packs' keys never collide in one export.
-- Nulls stay nulls (the CLI writes empty strings); lists come in a stable order, so exporting
-- the same item twice gives the same hash.
create or replace function app.content_pack_export_item(p_item_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', case when i.pack_slug = p_slug then i.pack_item_key else i.id::text end,
    'type', i.type,
    'title', i.title,
    'summary', i.summary,
    'gradeCodes', coalesce((
      select jsonb_agg(g.grade_code order by gr.ordinal)
      from public.library_item_grades g join public.grades gr on gr.code = g.grade_code
      where g.item_id = i.id), '[]'::jsonb),
    'subjectCode', s.code,
    'expectations', coalesce((
      select jsonb_agg(jsonb_build_object('curriculumVersion', ce.curriculum_version,
          'gradeCode', ce.grade_code, 'code', ce.code)
        order by ce.curriculum_version, ce.grade_code, ce.code)
      from public.library_item_expectations le
      join public.curriculum_expectations ce on ce.id = le.expectation_id
      where le.item_id = i.id), '[]'::jsonb),
    'durationMinutes', i.duration_minutes,
    'materials', i.materials,
    'keywords', i.keywords,
    'formats', jsonb_build_object('printable', i.is_printable, 'projectable', i.is_projectable,
      'interactive', i.is_interactive),
    'safetyNotes', i.safety_notes,
    'faith', jsonb_build_object(
      'faithContent', i.faith_content,
      'catholicConnection', i.catholic_connection,
      'reference', (select jsonb_build_object('type', r.type, 'title', r.title)
                    from public.catholic_references r where r.id = i.catholic_reference_id),
      'onStudentSheet', i.faith_on_student_sheet),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label_fr) order by t.slug)
      from public.library_item_tags it join public.tags t on t.id = it.tag_id
      where it.item_id = i.id), '[]'::jsonb),
    'licence', i.licence,
    'noDerivatives', i.no_derivatives,
    'provenance', jsonb_build_object('source', i.source, 'promptVersion', i.prompt_version,
      'model', i.model),
    -- The base version and board levels' versions; never a teacher's personal level (D-099).
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('level', ll.code, 'schemaVersion', v.schema_version,
          'content', v.content, 'answerKey', k.answer_key)
        order by ll.sort_order nulls first, ll.code)
      from public.library_item_versions v
      left join public.language_levels ll on ll.id = v.language_level_id
      left join public.library_item_answer_keys k on k.version_id = v.id
      where v.item_id = i.id and (v.language_level_id is null or ll.owner_user_id is null)),
      '[]'::jsonb))
  from public.library_items i
  -- A learning-skills comment bank has no subject (D-129): its subjectCode is null.
  left join public.subjects s on s.id = i.subject_id
  where i.id = p_item_id;
$$;

-- A page of the board's exportable items (20261101090400_content_packs.sql), now with the items
-- that have no subject.
create or replace function public.content_pack_export_items(
  p_board_id uuid,
  p_filters jsonb,
  p_after uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit integer := coalesce(p_limit, 100);
  v_slug text;
  v_publisher text;
  v_teacher boolean;
  v_packs boolean;
  v_grades text[];
  v_subjects text[];
  v_ids uuid[];
  v_items jsonb;
  v_levels jsonb;
begin
  if p_board_id is null or not exists (select 1 from public.boards b where b.id = p_board_id) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or v_limit not between 1 and 100
    or coalesce(v_filters ->> 'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or coalesce(jsonb_typeof(v_filters -> 'publisher'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'includeTeacherItems'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'includePackItems'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'gradeCodes'), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(v_filters -> 'subjectCodes'), 'null') not in ('array', 'null')
  then
    raise exception 'invalid filters' using errcode = '22023';
  end if;
  v_slug := v_filters ->> 'slug';
  v_publisher := lower(nullif(btrim(v_filters ->> 'publisher'), ''));
  v_teacher := coalesce((v_filters ->> 'includeTeacherItems')::boolean, false);
  v_packs := coalesce((v_filters ->> 'includePackItems')::boolean, false);
  v_grades := array(select jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'gradeCodes')));
  v_subjects := array(select jsonb_array_elements_text(app.jsonb_array_or_empty(v_filters -> 'subjectCodes')));

  v_ids := array(
    select i.id
    from public.library_items i
    -- Items without a subject too (a learning-skills comment bank, D-129).
    left join public.subjects s on s.id = i.subject_id
    left join public.content_packs cp on cp.id = i.content_pack_id
    where i.board_id = p_board_id
      and i.status = 'board_approved'
      and (i.board_owned or v_teacher)
      and (i.content_pack_id is null or v_packs
        or (v_publisher is not null and lower(btrim(cp.publisher)) = v_publisher))
      and (cardinality(v_grades) = 0 or exists (
        select 1 from public.library_item_grades g where g.item_id = i.id and g.grade_code = any (v_grades)))
      and (cardinality(v_subjects) = 0 or s.code = any (v_subjects))
      and (p_after is null or i.id > p_after)
    order by i.id
    limit v_limit + 1);

  select coalesce(jsonb_agg(app.content_pack_export_item(x.id, v_slug) order by x.n), '[]'::jsonb)
  into v_items
  from unnest(v_ids[1:v_limit]) with ordinality x (id, n);

  if p_after is null then
    select coalesce(jsonb_agg(jsonb_build_object('code', ll.code, 'labelFr', ll.label_fr,
        'labelEn', ll.label_en) order by ll.sort_order, ll.code), '[]'::jsonb)
    into v_levels
    from public.language_levels ll
    where ll.board_id = p_board_id and ll.owner_user_id is null;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'next', case when cardinality(v_ids) > v_limit then v_ids[v_limit] end)
    || case when p_after is null then jsonb_build_object('levels', v_levels) else '{}'::jsonb end;
end;
$$;


-- Applying a pack (20261101090500_phase5_review_fixes.sql), with one change: a learning-skills
-- comment bank (base version's scope) may come without a subject.
create or replace function app.content_pack_run(p_import_id uuid, p_options jsonb, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.content_pack_imports;
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_level_map jsonb;
  v_approve boolean;
  v_approver uuid;
  v_approver_ok boolean;
  v_header jsonb;
  v_board uuid;
  v_pack_no_derivatives boolean;
  v_pack_id uuid := gen_random_uuid();
  v_count integer;
  v_checksum text;
  r record;
  x record;
  v_item jsonb;
  v_existing public.library_items;
  v_outcome text;
  v_warnings text[];
  v_type public.library_item_type;
  v_subject uuid;
  v_title text;
  v_grades text[];
  v_exps uuid[];
  v_exp uuid;
  v_tags uuid[];
  v_tag uuid;
  v_label text;
  v_ref uuid;
  v_ref_count integer;
  v_versions jsonb[];
  v_version_keys text[];
  v_level uuid;
  v_has_base boolean;
  v_version_id uuid;
  v_faith boolean;
  v_source public.library_source;
  v_id uuid;
  v_ready boolean;
  v_detail text;
  v_queued boolean;
  v_approved boolean;
  v_status public.library_item_status;
  v_requires_faith boolean;
  v_tag_ids jsonb := '{}'::jsonb;
  v_new_tags text[] := '{}';
  v_dropped_tags text[] := '{}';
  v_report_items jsonb[] := '{}';
  v_items jsonb;
  v_not_in_pack jsonb;
  v_counts jsonb;
  v_keys_by_outcome jsonb;
begin
  -- Options
  if jsonb_typeof(v_options) <> 'object'
    or coalesce(jsonb_typeof(v_options -> 'levelMap'), 'null') not in ('object', 'null')
    or coalesce(jsonb_typeof(v_options -> 'approve'), 'null') not in ('boolean', 'null')
    or coalesce(jsonb_typeof(v_options -> 'approverId'), 'null') not in ('string', 'null')
    or coalesce(v_options ->> 'approverId', '00000000-0000-0000-0000-000000000000')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or exists (
      select 1 from jsonb_each(coalesce(nullif(v_options -> 'levelMap', 'null'::jsonb), '{}'::jsonb)) m
      where m.key !~ '^[a-z0-9_]{2,32}$' or jsonb_typeof(m.value) <> 'string'
        or (m.value #>> '{}') !~ '^[a-z0-9_]{2,32}$')
  then
    raise exception 'invalid options' using errcode = '22023';
  end if;
  v_level_map := coalesce(nullif(v_options -> 'levelMap', 'null'::jsonb), '{}'::jsonb);
  v_approve := coalesce((v_options ->> 'approve')::boolean, false);
  v_approver := (v_options ->> 'approverId')::uuid;

  -- The import, one apply at a time per pack and board.
  select * into v_import from public.content_pack_imports where id = p_import_id for update;
  if v_import.id is null then
    raise exception 'unknown import' using errcode = '22023';
  end if;
  if v_import.status <> 'staged' then
    raise exception 'the import is no longer staged' using errcode = 'LXP03';
  end if;
  v_board := v_import.board_id;
  v_header := v_import.header;
  v_pack_no_derivatives := coalesce((v_header #>> '{pack,noDerivatives}')::boolean, false);
  perform pg_advisory_xact_lock(hashtextextended('content_pack:' || v_board || ':' || v_import.slug, 0));
  perform app.content_pack_check_version(v_board, v_import.slug, v_import.version);

  -- Every item of the file is staged, and nothing else (the same sorted « key hash » lines as
  -- packChecksum in @lynx/content).
  select count(*)::integer,
    encode(sha256(convert_to(coalesce(string_agg(ii.key || ' ' || (ii.item ->> 'hash'), E'\n'
      order by (ii.key || ' ' || (ii.item ->> 'hash')) collate "C"), ''), 'UTF8')), 'hex')
  into v_count, v_checksum
  from public.content_pack_import_items ii where ii.import_id = v_import.id;
  if v_count = 0 or v_checksum is distinct from v_header ->> 'checksum' then
    raise exception 'the staged items differ from the pack''s checksum' using errcode = 'LXP05';
  end if;

  if v_approve then
    v_approver_ok := v_approver is not null and app.library_reviewer(v_approver, v_board, 'content');
    if not v_approver_ok and not p_dry_run then
      raise exception 'the approver is not a content reviewer of the board' using errcode = 'LXP04';
    end if;
  end if;

  insert into public.content_packs (id, board_id, slug, version, title, publisher, manifest,
    format_version, file_sha256, licence, item_count, approved_by)
  values (v_pack_id, v_board, v_import.slug, v_import.version,
    left(btrim(v_header #>> '{pack,title}'), 160), left(btrim(v_header #>> '{pack,publisher}'), 120),
    v_header, 1, v_import.file_sha256, nullif(btrim(v_header #>> '{pack,licence}'), ''), v_count,
    case when v_approve and v_approver_ok then v_approver end);

  for r in
    select ii.key, ii.item, ii.faith_suggested
    from public.content_pack_import_items ii
    where ii.import_id = v_import.id
    order by ii.key collate "C"
  loop
    v_item := r.item;
    v_warnings := '{}';
    v_outcome := null;
    v_id := null;
    v_queued := false;
    v_approved := false;
    v_existing := null;

    -- What to do with it.
    if not exists (
      select 1 from unnest(enum_range(null::public.library_item_type)) t
      where t::text = v_item ->> 'type'
    ) then
      v_outcome := 'skipped_unresolved';
      v_warnings := v_warnings || 'typeUnknown'::text;
    else
      v_type := (v_item ->> 'type')::public.library_item_type;
      select * into v_existing from public.library_items i
      where i.board_id = v_board and i.pack_slug = v_import.slug and i.pack_item_key = r.key
      for update;
      if v_existing.id is null then
        -- Deleted here since an earlier version wrote it: never created again (D-100).
        v_outcome := case when exists (
            select 1 from public.content_pack_removed_items d
            where d.board_id = v_board and d.pack_slug = v_import.slug and d.pack_item_key = r.key)
          then 'skipped_deleted_locally' else 'create' end;
      elsif v_existing.type <> v_type then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'typeChanged'::text;
      elsif v_existing.pack_content_hash = v_item ->> 'hash' then
        v_outcome := 'unchanged';
      elsif v_existing.content_revision is distinct from v_existing.pack_revision then
        v_outcome := 'skipped_modified_locally';
      elsif v_existing.status in ('board_approved', 'archived') or not v_existing.board_owned then
        v_outcome := 'changed_not_applied';
      else
        v_outcome := 'update';
      end if;
    end if;

    -- Resolve and check what a create or an update writes.
    if v_outcome in ('create', 'update') then
      v_title := btrim(coalesce(v_item ->> 'title', ''));
      if char_length(v_title) not between 1 and 200
        or char_length(coalesce(v_item ->> 'summary', '')) > 1000
        or char_length(coalesce(v_item ->> 'materials', '')) > 4000
        or char_length(coalesce(v_item ->> 'keywords', '')) > 300
        or char_length(coalesce(v_item #>> '{faith,catholicConnection}', '')) > 2000
        or char_length(coalesce(v_item ->> 'licence', '')) > 200
        or char_length(coalesce(v_item #>> '{provenance,promptVersion}', '')) > 40
        or char_length(coalesce(v_item #>> '{provenance,model}', '')) > 80
        or coalesce(v_item #>> '{provenance,source}', '')
          not in ('board_created', 'teacher_created', 'ai_generated')
        or jsonb_typeof(v_item -> 'formats') is distinct from 'object'
        or coalesce(jsonb_typeof(v_item -> 'safetyNotes'), 'null') not in ('object', 'null')
        or coalesce(jsonb_typeof(v_item -> 'durationMinutes'), 'null') not in ('number', 'null')
        or (jsonb_typeof(v_item -> 'durationMinutes') = 'number' and (
          (v_item ->> 'durationMinutes')::numeric not between 1 and 600
          or (v_item ->> 'durationMinutes')::numeric <> trunc((v_item ->> 'durationMinutes')::numeric)))
        or jsonb_typeof(v_item -> 'versions') is distinct from 'array'
        or exists (
          select 1 from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'versions')) v
          where jsonb_typeof(v) <> 'object'
            or jsonb_typeof(v -> 'content') is distinct from 'object'
            or pg_column_size(v -> 'content') > 131072
            or coalesce(jsonb_typeof(v -> 'answerKey'), 'null') not in ('object', 'null')
            or pg_column_size(v -> 'answerKey') > 65536
            or coalesce(jsonb_typeof(v -> 'level'), 'null') not in ('string', 'null'))
      then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'invalid'::text;
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      v_subject := null;
      -- A learning-skills comment bank has no subject (D-129): its base version says so.
      if not (v_type = 'report_comments' and v_item ->> 'subjectCode' is null and exists (
          select 1 from jsonb_array_elements(v_item -> 'versions') v
          where v ->> 'level' is null and v #>> '{content,scope}' = 'learning_skills'))
      then
        select s.id into v_subject from public.subjects s
        where s.code = v_item ->> 'subjectCode' and s.active
          and (s.board_id = v_board or s.board_id is null)
        order by s.board_id nulls last
        limit 1;
        if v_subject is null then
          v_outcome := 'skipped_unresolved';
          v_warnings := v_warnings || ('subjectUnknown:' || coalesce(v_item ->> 'subjectCode', ''));
        end if;
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      -- Versions: the base one is required; each board level once.
      v_versions := '{}';
      v_version_keys := '{}';
      v_has_base := false;
      for x in
        select v.value as version
        from jsonb_array_elements(v_item -> 'versions') with ordinality v (value, n)
        order by v.n
      loop
        if x.version ->> 'level' is null then
          if v_has_base then
            continue;
          end if;
          v_has_base := true;
          v_level := null;
        else
          v_level := null;
          select ll.id into v_level from public.language_levels ll
          where ll.board_id = v_board and ll.owner_user_id is null
            and ll.code = coalesce(v_level_map ->> (x.version ->> 'level'), x.version ->> 'level');
          if v_level is null or not app.library_type_levelable(v_type)
            or v_level::text = any (v_version_keys)
          then
            v_warnings := v_warnings || ('levelSkipped:' || (x.version ->> 'level'));
            continue;
          end if;
        end if;
        v_version_keys := v_version_keys || coalesce(v_level::text, 'base');
        v_versions := v_versions || jsonb_build_object('levelId', v_level,
          'content', x.version -> 'content', 'answerKey', x.version -> 'answerKey');
      end loop;
      if not v_has_base then
        v_outcome := 'skipped_unresolved';
        v_warnings := v_warnings || 'baseMissing'::text;
      end if;
    end if;

    if v_outcome in ('create', 'update') then
      -- Grades, attentes, tags and the Catholic reference, by code.
      v_grades := array(
        select g.code from public.grades g
        where g.code in (select jsonb_array_elements_text(app.jsonb_array_or_empty(v_item -> 'gradeCodes')))
        order by g.ordinal);
      v_warnings := v_warnings || array(
        select 'gradeUnknown:' || c
        from jsonb_array_elements_text(app.jsonb_array_or_empty(v_item -> 'gradeCodes')) c
        where c <> all (v_grades));

      v_exps := '{}';
      for x in
        select e.value as e
        from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'expectations')) with ordinality e (value, n)
        order by e.n
      loop
        v_exp := null;
        select ce.id into v_exp from public.curriculum_expectations ce
        where ce.subject_id = v_subject and ce.curriculum_version = x.e ->> 'curriculumVersion'
          and ce.grade_code = x.e ->> 'gradeCode' and ce.code = x.e ->> 'code'
          and ce.grade_code = any (v_grades);
        if v_exp is null then
          v_warnings := v_warnings || ('expectationUnknown:' || concat_ws(' ',
            x.e ->> 'curriculumVersion', x.e ->> 'gradeCode', x.e ->> 'code'));
        elsif v_exp <> all (v_exps) then
          v_exps := v_exps || v_exp;
        end if;
      end loop;

      v_tags := '{}';
      for x in
        select t.value #>> '{}' as slug
        from jsonb_array_elements(app.jsonb_array_or_empty(v_item -> 'tags')) with ordinality t (value, n)
        order by t.n
      loop
        if not (v_tag_ids ? x.slug) then
          v_tag := null;
          select t.id into v_tag from public.tags t
          where t.slug = x.slug and (t.board_id = v_board or t.board_id is null)
          order by t.board_id nulls last
          limit 1;
          if v_tag is null then
            select btrim(d ->> 'labelFr') into v_label
            from jsonb_array_elements(v_header -> 'tags') d
            where d ->> 'slug' = x.slug
            limit 1;
            if coalesce(x.slug, '') ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and coalesce(v_label, '') <> ''
              and cardinality(v_new_tags) < 30
            then
              insert into public.tags (board_id, slug, label_fr)
              values (v_board, x.slug, left(v_label, 60))
              returning id into v_tag;
              v_new_tags := v_new_tags || x.slug;
            else
              v_dropped_tags := v_dropped_tags || x.slug;
            end if;
          end if;
          v_tag_ids := v_tag_ids || jsonb_build_object(x.slug, v_tag);
        end if;
        v_tag := (v_tag_ids ->> x.slug)::uuid;
        if v_tag is null then
          v_warnings := v_warnings || ('tagDropped:' || x.slug);
        elsif v_tag <> all (v_tags) then
          v_tags := v_tags || v_tag;
        end if;
      end loop;

      v_ref := null;
      if jsonb_typeof(v_item #> '{faith,reference}') = 'object' then
        select count(*)::integer, (array_agg(cr.id))[1] into v_ref_count, v_ref
        from public.catholic_references cr
        where cr.board_id = v_board and cr.active
          and cr.type::text = v_item #>> '{faith,reference,type}'
          and cr.title = v_item #>> '{faith,reference,title}';
        if v_ref_count = 0 then
          select count(*)::integer, (array_agg(cr.id))[1] into v_ref_count, v_ref
          from public.catholic_references cr
          where cr.board_id is null and cr.active
            and cr.type::text = v_item #>> '{faith,reference,type}'
            and cr.title = v_item #>> '{faith,reference,title}';
        end if;
        if v_ref_count <> 1 then
          v_ref := null;
          v_warnings := v_warnings
            || case when v_ref_count = 0 then 'referenceUnknown' else 'referenceAmbiguous' end;
        end if;
      end if;

      -- Faith content: the pack's flag, faith words the CLI found, or a named Catholic
      -- reference (the items trigger adds reflections and Enseignement religieux).
      v_faith := coalesce((v_item #>> '{faith,faithContent}')::boolean, false) or r.faith_suggested
        or jsonb_typeof(v_item #> '{faith,reference}') = 'object';
      v_source := case when v_item #>> '{provenance,source}' = 'ai_generated'
        then 'ai_generated' else 'board_created' end::public.library_source;

      -- Write it.
      if v_outcome = 'create' then
        v_id := gen_random_uuid();
        insert into public.library_items (id, board_id, school_id, type, title, summary, status,
          share_scope, source, author_id, board_owned, licence, content_pack_id, pack_slug,
          pack_item_key, pack_content_hash, subject_id, duration_minutes, materials, keywords,
          is_printable, is_projectable, is_interactive, sub_friendly, safety_notes, faith_content,
          faith_on_student_sheet, catholic_connection, catholic_reference_id, prompt_version,
          model, no_derivatives)
        values (v_id, v_board, null, v_type, v_title, nullif(btrim(v_item ->> 'summary'), ''),
          'draft', 'private', v_source, null, true, nullif(btrim(v_item ->> 'licence'), ''),
          v_pack_id, v_import.slug, r.key, v_item ->> 'hash', v_subject,
          (v_item ->> 'durationMinutes')::smallint, nullif(btrim(v_item ->> 'materials'), ''),
          nullif(btrim(v_item ->> 'keywords'), ''),
          coalesce((v_item #>> '{formats,printable}')::boolean, true),
          coalesce((v_item #>> '{formats,projectable}')::boolean, false),
          coalesce((v_item #>> '{formats,interactive}')::boolean, false),
          false,
          case when jsonb_typeof(v_item -> 'safetyNotes') = 'object' then v_item -> 'safetyNotes' end,
          v_faith, coalesce((v_item #>> '{faith,onStudentSheet}')::boolean, false),
          nullif(btrim(v_item #>> '{faith,catholicConnection}'), ''), v_ref,
          nullif(btrim(v_item #>> '{provenance,promptVersion}'), ''),
          nullif(btrim(v_item #>> '{provenance,model}'), ''),
          coalesce((v_item ->> 'noDerivatives')::boolean, false) or v_pack_no_derivatives);
      else
        v_id := v_existing.id;
        update public.library_items i set
          title = v_title,
          summary = nullif(btrim(v_item ->> 'summary'), ''),
          source = v_source,
          licence = nullif(btrim(v_item ->> 'licence'), ''),
          content_pack_id = v_pack_id,
          pack_content_hash = v_item ->> 'hash',
          subject_id = v_subject,
          duration_minutes = (v_item ->> 'durationMinutes')::smallint,
          materials = nullif(btrim(v_item ->> 'materials'), ''),
          keywords = nullif(btrim(v_item ->> 'keywords'), ''),
          is_printable = coalesce((v_item #>> '{formats,printable}')::boolean, true),
          is_projectable = coalesce((v_item #>> '{formats,projectable}')::boolean, false),
          is_interactive = coalesce((v_item #>> '{formats,interactive}')::boolean, false),
          sub_friendly = false,
          safety_notes = case when jsonb_typeof(v_item -> 'safetyNotes') = 'object'
            then v_item -> 'safetyNotes' end,
          -- A reviewer's faith flag stays (D-064).
          faith_content = v_faith or i.faith_flagged_by is not null,
          faith_on_student_sheet = coalesce((v_item #>> '{faith,onStudentSheet}')::boolean, false),
          catholic_connection = nullif(btrim(v_item #>> '{faith,catholicConnection}'), ''),
          catholic_reference_id = v_ref,
          prompt_version = nullif(btrim(v_item #>> '{provenance,promptVersion}'), ''),
          model = nullif(btrim(v_item #>> '{provenance,model}'), ''),
          no_derivatives = coalesce((v_item ->> 'noDerivatives')::boolean, false) or v_pack_no_derivatives,
          review_note = null
        where i.id = v_id;
        delete from public.library_item_grades g where g.item_id = v_id;
        delete from public.library_item_expectations e where e.item_id = v_id;
        delete from public.library_item_tags t where t.item_id = v_id;
        delete from public.library_item_versions lv
        where lv.item_id = v_id and coalesce(lv.language_level_id::text, 'base') <> all (v_version_keys);
      end if;

      insert into public.library_item_grades (item_id, grade_code)
      select v_id, g from unnest(v_grades) g;
      insert into public.library_item_expectations (item_id, expectation_id)
      select v_id, e from unnest(v_exps) e;
      insert into public.library_item_tags (item_id, tag_id)
      select v_id, t from unnest(v_tags) t;
      for x in select v.value as version from unnest(v_versions) v (value) loop
        v_level := nullif(x.version ->> 'levelId', '')::uuid;
        v_version_id := null;
        select lv.id into v_version_id from public.library_item_versions lv
        where lv.item_id = v_id and lv.language_level_id is not distinct from v_level;
        if v_version_id is null then
          perform app.library_insert_version(v_id, v_level, x.version -> 'content',
            x.version -> 'answerKey');
        else
          update public.library_item_versions
          set content = x.version -> 'content', schema_version = 1
          where id = v_version_id;
          if jsonb_typeof(x.version -> 'answerKey') = 'object' then
            insert into public.library_item_answer_keys (version_id, answer_key)
            values (v_version_id, x.version -> 'answerKey')
            on conflict (version_id) do update
              set answer_key = excluded.answer_key, updated_at = now();
          else
            delete from public.library_item_answer_keys where version_id = v_version_id;
          end if;
        end if;
      end loop;

      if v_outcome = 'create' then
        perform app.library_refresh_search(v_id);
      else
        -- A new revision; the request and any faith review no longer apply (D-063).
        perform app.library_content_changed(v_id);
      end if;
      update public.library_items set pack_revision = content_revision where id = v_id;

      -- Ready for approval: into the reviewers' queue. Otherwise a draft.
      begin
        perform app.library_assert_ready(v_id, true);
        v_ready := true;
      exception when sqlstate 'LXL01' or sqlstate 'LXL02' then
        get stacked diagnostics v_detail = pg_exception_detail;
        v_ready := false;
        v_warnings := v_warnings || ('notReady:' || coalesce(nullif(v_detail, ''), 'safetyNotes'));
      end;
      if v_ready then
        update public.library_items
        set status = 'teacher_reviewed', review_requested_at = now(), review_requested_by = null,
            review_note = null
        where id = v_id;
        v_queued := true;
      else
        update public.library_items
        set status = 'draft', share_scope = 'private', review_requested_at = null,
            review_requested_by = null
        where id = v_id;
      end if;

      if v_queued and v_approve and v_approver_ok then
        select i.requires_faith_review into v_requires_faith from public.library_items i
        where i.id = v_id;
        if v_requires_faith then
          v_warnings := v_warnings || 'approvalFaithReview'::text;
        elsif v_type in ('experiment', 'stem_challenge', 'outdoor_activity') then
          v_warnings := v_warnings || 'approvalByReviewer'::text;
        else
          perform app.content_pack_approve_item(v_id, v_approver, v_pack_id);
          v_approved := true;
        end if;
      end if;
    end if;

    select i.status into v_status from public.library_items i
    where i.id = coalesce(v_id, v_existing.id);
    v_report_items := v_report_items || jsonb_build_object(
      'key', r.key,
      'type', v_item ->> 'type',
      'title', left(v_item ->> 'title', 200),
      'outcome', v_outcome,
      'status', v_status,
      'queued', v_queued,
      'approved', v_approved,
      'warnings', to_jsonb(v_warnings));
  end loop;

  v_items := to_jsonb(v_report_items);

  -- Items of earlier versions that this one no longer has (reported, never removed).
  select coalesce(jsonb_agg(i.pack_item_key order by i.pack_item_key collate "C"), '[]'::jsonb)
  into v_not_in_pack
  from public.library_items i
  where i.board_id = v_board and i.pack_slug = v_import.slug and i.status <> 'archived'
    and not exists (
      select 1 from public.content_pack_import_items ii
      where ii.import_id = v_import.id and ii.key = i.pack_item_key);

  select jsonb_build_object(
      'created', count(*) filter (where e ->> 'outcome' = 'create'),
      'updated', count(*) filter (where e ->> 'outcome' = 'update'),
      'unchanged', count(*) filter (where e ->> 'outcome' = 'unchanged'),
      'changedNotApplied', count(*) filter (where e ->> 'outcome' = 'changed_not_applied'),
      'skippedModifiedLocally', count(*) filter (where e ->> 'outcome' = 'skipped_modified_locally'),
      'skippedDeletedLocally', count(*) filter (where e ->> 'outcome' = 'skipped_deleted_locally'),
      'skippedUnresolved', count(*) filter (where e ->> 'outcome' = 'skipped_unresolved'),
      'queued', count(*) filter (where (e ->> 'queued')::boolean),
      'approved', count(*) filter (where (e ->> 'approved')::boolean),
      'drafts', count(*) filter (where e ->> 'outcome' in ('create', 'update')
        and not (e ->> 'queued')::boolean),
      'notInPack', jsonb_array_length(v_not_in_pack)),
    jsonb_build_object(
      'changedNotApplied', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'changed_not_applied'), '[]'::jsonb),
      'skippedModifiedLocally', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_modified_locally'), '[]'::jsonb),
      'skippedDeletedLocally', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_deleted_locally'), '[]'::jsonb),
      'skippedUnresolved', coalesce(jsonb_agg(e -> 'key') filter (
        where e ->> 'outcome' = 'skipped_unresolved'), '[]'::jsonb))
  into v_counts, v_keys_by_outcome
  from jsonb_array_elements(v_items) e;

  update public.content_packs
  set report = jsonb_build_object('counts', v_counts, 'notInPack', v_not_in_pack,
      'newTags', to_jsonb(v_new_tags), 'droppedTags', to_jsonb(v_dropped_tags)) || v_keys_by_outcome
  where id = v_pack_id;

  update public.content_pack_imports set status = 'applied', applied_at = now()
  where id = v_import.id;
  delete from public.content_pack_import_items where import_id = v_import.id;

  perform app.log_audit('content_pack.imported', v_board, null, 'content_pack', v_pack_id,
    jsonb_build_object('slug', v_import.slug, 'version', v_import.version,
      'created', v_counts -> 'created', 'updated', v_counts -> 'updated',
      'unchanged', v_counts -> 'unchanged',
      'skipped', (v_counts ->> 'changedNotApplied')::integer
        + (v_counts ->> 'skippedModifiedLocally')::integer
        + (v_counts ->> 'skippedDeletedLocally')::integer
        + (v_counts ->> 'skippedUnresolved')::integer,
      'approved', v_counts -> 'approved', 'file_sha256', v_import.file_sha256),
    'service');
  perform app.emit_event('content_pack.imported', v_board, null, 'content_pack', v_pack_id,
    jsonb_build_object('packId', v_pack_id));

  return jsonb_build_object(
    'packId', v_pack_id,
    'pack', jsonb_build_object('slug', v_import.slug, 'version', v_import.version,
      'title', v_header #>> '{pack,title}', 'publisher', v_header #>> '{pack,publisher}'),
    'fileSha256', v_import.file_sha256,
    'approverOk', v_approver_ok,
    'counts', v_counts,
    'items', v_items,
    'notInPack', v_not_in_pack,
    'newTags', to_jsonb(v_new_tags),
    'droppedTags', to_jsonb(v_dropped_tags));
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 10. « Couverture du curriculum » (D-094): a comment bank never counts as a resource for an
--     attente, so a bank neither fills a gap nor keeps bulk generation (« --from-coverage »)
--     from planning one. Copied whole from 20261101090200_library_coverage.sql.
-- ---------------------------------------------------------------------------------------

create or replace function app.library_coverage_rows(p_board_id uuid, p_grade_code text, p_subject_id uuid)
returns table (
  expectation_id uuid,
  parent_id uuid,
  strand_id uuid,
  kind public.expectation_kind,
  code text,
  text_fr text,
  is_verified boolean,
  sort_order integer,
  has_children boolean,
  approved_count integer,
  in_review_count integer,
  approved_types text[],
  text_en text,
  grade_code text,
  subject_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with exps as (
    select e.id, e.parent_id, e.strand_id, e.kind, e.code, e.text_fr, e.text_en, e.is_verified,
      e.sort_order, e.grade_code, e.subject_id,
      exists (select 1 from public.curriculum_expectations c where c.parent_id = e.id) as has_children
    from public.curriculum_expectations e
    join public.subjects s on s.id = e.subject_id
    where (p_grade_code is null or e.grade_code = p_grade_code)
      and (p_subject_id is null or e.subject_id = p_subject_id)
      and (s.board_id is null or s.board_id = p_board_id)
  ),
  -- Which item links count for each attente: its own; for an overall attente, its specific
  -- attentes' too (a union, so an item linked to both counts once).
  links as (
    select x.id as expectation_id, le.item_id
    from exps x
    join public.library_item_expectations le on le.expectation_id = x.id
    union
    select x.id, le.item_id
    from exps x
    join public.curriculum_expectations c on c.parent_id = x.id
    join public.library_item_expectations le on le.expectation_id = c.id
    where x.kind = 'overall'
  ),
  items as (
    select l.expectation_id, i.id, i.type, i.status, i.board_owned, i.review_requested_at
    from links l
    join public.library_items i on i.id = l.item_id
    -- A comment bank is not a teaching resource (D-129): it never covers an attente.
    where i.board_id = p_board_id and i.status <> 'archived' and i.type <> 'report_comments'
  )
  select x.id, x.parent_id, x.strand_id, x.kind, x.code, x.text_fr, x.is_verified, x.sort_order,
    x.has_children,
    (count(distinct it.id) filter (where it.status = 'board_approved'))::integer,
    (count(distinct it.id) filter (where it.status <> 'board_approved'
      and (it.review_requested_at is not null or it.board_owned)))::integer,
    coalesce(array_agg(distinct it.type::text) filter (where it.status = 'board_approved'),
      '{}'::text[]),
    x.text_en, x.grade_code, x.subject_id
  from exps x
  left join items it on it.expectation_id = x.id
  group by x.id, x.parent_id, x.strand_id, x.kind, x.code, x.text_fr, x.text_en, x.is_verified,
    x.sort_order, x.has_children, x.grade_code, x.subject_id;
$$;


-- ---------------------------------------------------------------------------------------
-- 11. Permissions: replacing a function keeps its grants; restated here.
-- ---------------------------------------------------------------------------------------

revoke execute on function
  app.library_bucket_for(public.library_item_type),
  app.library_type_levelable(public.library_item_type),
  app.library_type_never_sub_friendly(public.library_item_type),
  app.library_type_terms(public.library_item_type),
  app.library_content_text(jsonb),
  app.library_assert_ready(uuid, boolean),
  app.unit_lessons_before_write(),
  app.library_item_ai_input_for_board(uuid, uuid, jsonb),
  app.content_pack_export_item(uuid, text),
  public.content_pack_export_items(uuid, jsonb, uuid, integer),
  app.content_pack_run(uuid, jsonb, boolean),
  app.library_coverage_rows(uuid, text, uuid)
from public, anon;
grant execute on function app.library_bucket_for(public.library_item_type)
to authenticated, service_role;
