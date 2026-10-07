-- Reference data every installation needs (not demo data), and provisioning functions
-- used by the admin CLI when onboarding a board or school.

insert into public.grades (code, ordinal, program, label_fr, short_label_fr, label_en) values
  ('K1', -1, 'kindergarten', 'Maternelle', 'Mat.', 'Junior Kindergarten'),
  ('K2', 0, 'kindergarten', 'Jardin d''enfants', 'Jard.', 'Senior Kindergarten'),
  ('1', 1, 'elementary', '1re année', '1re', 'Grade 1'),
  ('2', 2, 'elementary', '2e année', '2e', 'Grade 2'),
  ('3', 3, 'elementary', '3e année', '3e', 'Grade 3'),
  ('4', 4, 'elementary', '4e année', '4e', 'Grade 4'),
  ('5', 5, 'elementary', '5e année', '5e', 'Grade 5'),
  ('6', 6, 'elementary', '6e année', '6e', 'Grade 6'),
  ('7', 7, 'elementary', '7e année', '7e', 'Grade 7'),
  ('8', 8, 'elementary', '8e année', '8e', 'Grade 8');

-- Standard Ontario elementary subjects (board_id null = available to every board).
-- Boards can add their own subjects; Anglais start grade is a board setting.
insert into public.subjects (code, label_fr, label_en, grade_min, grade_max, color, sort_order) values
  ('pmje', 'Programme de la maternelle et du jardin d''enfants', 'Kindergarten Program', -1, 0, '#0f766e', 5),
  ('fra', 'Français', 'French', 1, 8, '#1d4ed8', 10),
  ('mat', 'Mathématiques', 'Mathematics', 1, 8, '#b91c1c', 20),
  ('sci', 'Sciences et technologie', 'Science and Technology', 1, 8, '#15803d', 30),
  ('etu', 'Études sociales', 'Social Studies', 1, 6, '#a16207', 40),
  ('hig', 'Histoire et géographie', 'History and Geography', 7, 8, '#a16207', 41),
  ('eps', 'Éducation physique et santé', 'Health and Physical Education', 1, 8, '#c2410c', 50),
  ('art', 'Éducation artistique', 'The Arts', 1, 8, '#7e22ce', 60),
  ('ere', 'Enseignement religieux', 'Religious Education', -1, 8, '#4338ca', 70),
  ('ang', 'Anglais', 'English', 1, 8, '#0e7490', 80);

-- Default language levels for a board. Deliberately not an official ALF/Ministry scale.
create function public.provision_board_defaults(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.language_levels (board_id, code, label_fr, label_en, description_fr, sort_order)
  values
    (p_board_id, 'debutant', 'Débutant', 'Beginner',
      'Phrases courtes, vocabulaire très fréquent, appuis visuels suggérés et glossaire.', 10),
    (p_board_id, 'intermediaire', 'Intermédiaire', 'Intermediate',
      'Phrases simples et vocabulaire courant, quelques mots nouveaux expliqués.', 20),
    (p_board_id, 'avance', 'Avancé', 'Advanced',
      'Texte du niveau scolaire attendu.', 30),
    (p_board_id, 'enrichi', 'Enrichi', 'Enriched',
      'Vocabulaire plus riche et questions d''approfondissement.', 40)
  on conflict do nothing;
end;
$$;

-- Default modules for a new school during the pilot: core, teaching and library.
create function public.provision_school_defaults(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.module_entitlements (school_id, module, enabled, licence_ref)
  values
    (p_school_id, 'core', true, 'pilot'),
    (p_school_id, 'teaching', true, 'pilot'),
    (p_school_id, 'library', true, 'pilot')
  on conflict (school_id, module) do nothing;
end;
$$;

revoke execute on function public.provision_board_defaults(uuid) from public, anon, authenticated;
revoke execute on function public.provision_school_defaults(uuid) from public, anon, authenticated;
grant execute on function public.provision_board_defaults(uuid) to service_role;
grant execute on function public.provision_school_defaults(uuid) to service_role;
