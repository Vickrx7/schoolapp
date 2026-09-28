-- Foundation: extensions, the private `app` schema, shared enums, utility functions,
-- and closed-by-default privileges.
--
-- Security model (see DECISIONS.md, D-012):
--   * Every table has Row Level Security enabled.
--   * The `anon` role gets nothing. The `authenticated` role gets explicit per-table grants,
--     so new tables are closed until a migration opens them on purpose.
--   * Helper functions used by RLS policies live in the `app` schema, which PostgREST does
--     not expose, so they cannot be called over the API.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- New tables and sequences in `public` are not reachable by API roles unless a migration
-- grants access explicitly (Supabase grants everything by default; we opt out).
-- Functions: Postgres always grants EXECUTE to PUBLIC on new functions and a per-schema
-- default cannot take that away, so the hardening migration revokes it explicitly and the
-- test suite checks it (supabase/tests/00_schema_invariants.test.sql).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Enums. Values are stable identifiers; French labels live in the UI translation files.
-- ---------------------------------------------------------------------------------------

create type public.app_role as enum (
  'teacher',
  'principal',
  'vice_principal',
  'office_admin',
  'facilities',
  'board_admin',
  'parent'
);

create type public.schedule_type as enum ('weekly', 'cycle');

create type public.module_key as enum (
  'core',
  'teaching',
  'library',
  'office',
  'safety_building',
  'board_analytics'
);

create type public.class_teacher_role as enum ('homeroom', 'subject', 'support');

create type public.alert_category as enum ('allergy', 'medical', 'safety', 'other');

create type public.block_kind as enum (
  'subject',
  'routine',
  'recess',
  'lunch',
  'nutrition_break',
  'prep',
  'duty',
  'other'
);

create type public.calendar_event_type as enum (
  'pa_day',
  'holiday',
  'early_dismissal',
  'late_start',
  'mass',
  'liturgy',
  'assembly',
  'field_trip',
  'other'
);

create type public.unit_status as enum ('planned', 'active', 'completed', 'archived');

create type public.lesson_progress_status as enum ('completed', 'skipped', 'pending_confirmation');

create type public.progress_source as enum ('teacher', 'substitute_report');

create type public.expectation_kind as enum ('overall', 'specific');

create type public.audit_actor_type as enum ('user', 'substitute', 'system', 'service');

-- ---------------------------------------------------------------------------------------
-- Utility trigger functions
-- ---------------------------------------------------------------------------------------

create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raises if the value is not a valid IANA time zone name known to Postgres.
create function app.assert_valid_timezone(p_timezone text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone p_timezone;
exception
  when others then
    raise exception 'invalid time zone: %', p_timezone using errcode = '22023';
end;
$$;
