-- Safety/medical alerts: only through functions, only for the class team and direction,
-- every read audited, never with the alert text in the audit log.
begin;
\ir _helpers.psql
select plan(21);
select tests.build_fixture();

select tests.authenticate_as('teacher_a');
select throws_ok('select * from public.student_alerts', '42501', null,
  'teachers cannot read the alerts table directly');
select throws_ok(
  $$insert into public.student_alerts (student_id, class_id, body_ciphertext) values (tests.id('student_a1'), tests.id('class_a'), 'x')$$,
  '42501', null, 'teachers cannot write the alerts table directly'
);
select lives_ok(
  $$select tests.remember('alert_1', public.save_student_alert(tests.id('student_a1'), 'allergy', 'v1:SECRET-CIPHERTEXT', 1::smallint))$$,
  'the class teacher can record an alert'
);
select is((select count(*)::int from public.get_class_alerts(tests.id('class_a'))), 1,
  'the class teacher can read the class''s alerts');
select throws_ok(
  $$select public.save_student_alert(tests.id('student_b'), 'medical', 'v1:x', 1::smallint)$$,
  '42501', null, 'a teacher cannot record alerts for another class'
);
select throws_ok(
  $$select * from public.get_class_alerts(tests.id('class_b'))$$,
  '42501', null, 'a teacher cannot read another class''s alerts'
);
select tests.clear_authentication();

select tests.authenticate_as('subject_teacher');
select is((select count(*)::int from public.get_class_alerts(tests.id('class_a'))), 1,
  'a subject teacher on the class team can read its alerts');
select tests.clear_authentication();

select tests.authenticate_as('principal_a');
select is((select count(*)::int from public.get_class_alerts(tests.id('class_a'))), 1,
  'the principal can read alerts for classes in their school');
select throws_ok(
  $$select public.save_student_alert(tests.id('student_a2'), 'medical', 'v1:x', 1::smallint)$$,
  '42501', null, 'the principal cannot edit alerts'
);
select tests.clear_authentication();

select tests.authenticate_as('office_a');
select throws_ok($$select * from public.get_class_alerts(tests.id('class_a'))$$, '42501', null,
  'office staff cannot read alerts');
select tests.clear_authentication();

select tests.authenticate_as('former_teacher');
select throws_ok($$select * from public.get_class_alerts(tests.id('class_a_other'))$$, '42501', null,
  'a deactivated teacher cannot read alerts');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok($$select * from public.get_class_alerts(tests.id('class_a'))$$, '42501', null,
  'anonymous users cannot call the alerts function');
select tests.clear_authentication();

-- Audit trail
select is(
  (select count(*)::int from public.audit_log where action = 'student_alert.viewed' and entity_id = tests.id('class_a')),
  3, 'every alert read is audited (teacher, subject teacher, principal)'
);
select is(
  (select count(*)::int from public.audit_log where action = 'student_alert.viewed'
     and entity_id = tests.id('class_a') and actor_user_id = tests.id('principal_a')),
  1, 'the audit entry records who looked'
);
select is(
  (select count(*)::int from public.audit_log where action = 'student_alert.created' and entity_id = tests.id('student_a1')),
  1, 'creating an alert is audited'
);
select is_empty(
  $$select id from public.audit_log where details::text like '%SECRET%'$$,
  'alert text never appears in the audit log'
);

-- Updating and deleting
select tests.authenticate_as('teacher_a');
select lives_ok(
  $$select public.save_student_alert(tests.id('student_a1'), 'medical', 'v1:UPDATED', 1::smallint, tests.id('alert_1'))$$,
  'the class teacher can update an alert'
);
select throws_ok(
  $$select public.save_student_alert(tests.id('student_a2'), 'medical', 'v1:x', 1::smallint, tests.id('alert_1'))$$,
  'P0002', null, 'an alert cannot be moved to another student'
);
select lives_ok($$select public.delete_student_alert(tests.id('alert_1'))$$,
  'the class teacher can delete an alert');
select tests.clear_authentication();

-- Alerts switched off for the school: reads return nothing (and log nothing), writes fail.
update public.schools set student_alerts_enabled = false where id = tests.id('school_a1');
select tests.authenticate_as('teacher_a');
select is((select count(*)::int from public.get_class_alerts(tests.id('class_a'))), 0,
  'no alerts are returned when the school has alerts turned off');
select throws_ok(
  $$select public.save_student_alert(tests.id('student_a1'), 'allergy', 'v1:x', 1::smallint)$$,
  '55000', null, 'alerts cannot be recorded when the school has them turned off'
);
select tests.clear_authentication();

select * from finish();
rollback;
