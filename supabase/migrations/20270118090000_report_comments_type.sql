-- « Commentaires de bulletin », slice S1: comment banks (« Banque de commentaires de bulletin »)
-- are library type 26 (DECISIONS D-129). Enum order: … quiz, unit_test, diagnostic, rubric,
-- report_comments, game, …
-- Tests: supabase/tests/35_report_comments.test.sql
--
-- A new enum value cannot be used in the transaction that adds it, so everything that uses it is
-- in the next migration (20270118090100_report_comments.sql).

alter type public.library_item_type add value 'report_comments' after 'rubric';
