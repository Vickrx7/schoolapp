-- Phase 3 (substitute hand-off): enum values the next migrations use.
-- An enum value must be committed before it is used, so this is its own migration.
-- DECISIONS: D-054 (the end-of-day report is drafted during the day).
-- Tests: supabase/tests/10_substitute_plans.test.sql

alter type public.sub_report_status add value if not exists 'draft' before 'submitted';
