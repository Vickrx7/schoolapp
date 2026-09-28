# Decisions

Significant decisions and deviations from `SPEC.md`, with the reason for each. Anything marked
**Assumption** was decided without input from a school board and should be checked with pilot
teachers or a board contact. It is designed to be easy to change later.

Format: **D-NNN — Title.** Decision. _Why._ Consequences / how to change it.

---

## Product and pilot

**D-001 — Build with defaults, adjust after the beta.** The Phase 1 questions were answered
"use your best judgement; make it configurable for other boards." Every default below is written
down here so it can be reviewed with pilot teachers.

**D-002 — Working product name "Lynx École" (placeholder).** Set by `NEXT_PUBLIC_APP_NAME`; no
code change is needed to rename.

**D-003 — Board differences live in data, not code.** Anything that plausibly differs between
boards or schools is a table row or a validated JSON setting:

- `boards.settings`: Anglais start grade, substitute-plan auto-release time, AI budget, AI on/off,
  class-mode retention (schema in `packages/domain/src/settings.ts`; invalid values fall back to
  defaults).
- `schools`: time zone, weekly vs. rotating-day schedule, cycle length, whether alerts are enabled,
  contact details and typical bell times (`schools.settings`).
- Per board: language levels, extra subjects, school years, calendar events, Catholic references.
- Per school: rooms, rotation anchors, licensed modules (`module_entitlements`).

Onboarding a new board is configuration only (see `pnpm admin`).

**D-004 — Accounts are invite-only (Assumption).** Sign-up is disabled in Supabase Auth. An admin
provisions boards, schools and staff with `pnpm admin ...` (apps/admin). _Why:_ boards control who
has access; no one can self-register with a personal address. A board-admin UI comes later.

## Schedule model

**D-005 — Timetables support both weekly and rotating-day schools (Assumption: pilot schools may
use either).** A timetable block has a `day_key`: 1–5 = Monday–Friday for weekly schools, or
Jour 1..N for cycle schools (`schools.cycle_length`, 2–20). For cycle schools the day number is
computed from **rotation anchors** ("on this date it is Jour N") by counting instructional days;
weekends, PA days and holidays do not advance the rotation. Adding an anchor resets it.
Logic and tests: `packages/domain/src/schedule.ts`.

**D-006 — Each block records who teaches it.** `timetable_blocks.teacher_id` is null for the
homeroom teacher, or a member of the class team (rotary teaching, prep coverage, e.g. EPS or
Anglais). A teacher's day = blocks assigned to them + unassigned blocks of classes where they are
homeroom. Blocks also have a kind (subject, routine, recess, lunch, nutrition break, prep, duty,
other) so routines like "Prière du matin et O Canada" appear in the day and in future substitute
plans. Overlapping blocks are allowed (split classes) and shown as a warning.

**D-007 — Combined classes.** A class has one or more grades (`class_grades`), e.g. 3e/4e année.

**D-008 — Calendar events have three scopes and predictable effects.** Board-wide (PA days,
holidays, breaks), school-wide (mass, assembly, early dismissal) or one class (field trip).
Effects on a day's blocks (`packages/domain/src/school-day.ts`): PA day/holiday → no school; early
dismissal/late start → blocks cancelled or shortened; other timed events → blocks fully covered are
"replaced", partially covered are "interrupted". Informational events can be marked as not
affecting the schedule. Kindergarten-specific structure is deferred (Assumption: the first pilot
teachers are in grades 1–8).

**D-009 — All school logic uses the school's local dates and times.** Each school has an IANA time
zone (northwestern Ontario schools may be on Central time). Dates are `YYYY-MM-DD` and times
`HH:MM` in that zone, never UTC instants, so daylight-saving changes cannot shift a school day.
Times display the Canadian French way ("8 h 45").

## Sequencing lessons

**D-010 — "Next lesson" = the first lesson in sequence that isn't done.** Done = completed or
skipped. If a lesson earlier in the unit was never checked off, it is shown as next with a warning
rather than silently skipped. Lessons already checked off on a given day stay on that day's
periods, and two periods of the same subject on one day get consecutive lessons. Lessons reported
by a substitute but not yet confirmed (`pending_confirmation`, Phase 3) count as done for
sequencing so the class doesn't repeat them. Tests: `packages/domain/src/lessons.test.ts`.

**D-011 — One active unit per class and subject** (enforced by a partial unique index).

## Privacy and security

**D-012 — Security model.** Row Level Security on every table; `anon` has no access to anything;
the signed-in role gets explicit per-table (and often per-column) grants, so a new table is closed
until a migration opens it. Helper functions used by policies live in a private `app` schema that
the API does not expose. PUBLIC `EXECUTE` is revoked from functions. The web app always runs as
the signed-in user; the service-role key is only used by admin tooling and the worker. Invariants
are tested (`supabase/tests/00_schema_invariants.test.sql`).

**D-013 — Who sees what (Assumption: to confirm with a board).**

| Role           | Sees                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Teacher        | Their classes (roster, schedule, planning, progress)                                                                |
| Principal / VP | Their school's classes, rosters and schedules, and alerts (read-only). **Not** teachers' units, lessons or progress |
| Office admin   | Their school's classes and schedules; no rosters                                                                    |
| Board admin    | Board configuration and schools; no student data                                                                    |

_Why:_ planning is the teacher's professional space; per-teacher progress visible to principals
reads as monitoring and would hurt trust (and may concern the teachers' union). Principal
oversight screens (absences, substitute-plan status) come in Phase 6.

**D-014 — Students are stored by a single first-name/nickname field.** The column is
`students.first_name` (max 40 characters). There is no last-name field anywhere. For two students
with the same name the UI suggests a marker like "Liam 2" (Assumption: whether a last initial
such as "Liam B." is acceptable is a board decision; the app does not suggest it).

**D-015 — Roster import happens in the browser.** CSV files are parsed on the teacher's device
(UTF-8 or Windows-1252, as Excel saves them in French). The teacher picks the first-name column;
columns that look sensitive (last name, OEN/NISO, birthdate, address, email, phone, health...) are
shown as "never sent" and cannot be selected. Only the chosen names are sent. Values that look
like more than a first name are flagged; empty, too-long and email-like values are blocked.

**D-016 — Safety/medical alerts: encrypted, audited, off by default.**

- Stored in `student_alerts`, which no API role can read or write directly; access is only
  through database functions that check the caller and write an audit entry on **every** read.
- The text is encrypted by the server (AES-256-GCM) before it reaches the database, with the
  student's id bound in so a ciphertext cannot be moved to another student. Keys come from
  `ALERTS_ENCRYPTION_KEYS` and support rotation. _Why:_ RLS protects rows from users; encryption
  also protects backups, dumps and support access.
- Each school has `student_alerts_enabled` (default **off**); a principal turns it on after board
  approval, and toggling it is audited.
- In the UI, alerts stay hidden until the teacher taps "Alerte de sécurité ou médicale", because
  classroom screens are often projected.
- Visible to the class team and the school's direction. Substitute access arrives in Phase 3.

**D-017 — Audit log is append-only.** No foreign keys (the record outlives what it describes), no
updates, no truncation; deletes only when a retention job explicitly opts in. Audited in Phase 1:
alert reads/writes, alert switch on/off, role grants/revocations, class-team changes, class
deletion. Audit entries never contain student names or alert text.

**D-018 — Proposed retention defaults (implemented as purge jobs in Phase 6).**

| Data                            | Retention                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| A class and everything in it    | Until the teacher deletes it (immediate, cascading), or end of school year + 1 year (proposed) |
| Audit log                       | 2 years                                                                                        |
| Dispatched outbox events        | 90 days                                                                                        |
| Class-mode responses            | Deleted when the session ends (unless the teacher keeps aggregate results, then 1 year)        |
| Substitute codes and sessions   | Expire the same day; deleted after 30 days                                                     |
| AI usage ledger (metadata only) | 2 years                                                                                        |

**D-019 — Login: 6-digit email code plus a "confirm" link.** The email contains both. The link
opens a page with a button that completes sign-in. _Why:_ board email security scanners
(e.g. Microsoft Safe Links) open links before the teacher does, which uses up one-time magic links;
scanners don't press buttons. Unknown addresses get the same response as known ones.

**D-020 — Roles.** All roles in the spec exist in the role model now (`app_role`: teacher,
principal, vice_principal, office_admin, facilities, board_admin, parent). School-scoped roles
require a school; board_admin is board-scoped. The substitute is deliberately **not** a user
account: Phase 3 gives them a single-day code (tables `sub_access_codes`, `sub_sessions` exist and
are closed to the API).

## Architecture

**D-021 — Monorepo layout (pnpm workspaces).** `apps/web` (Next.js), `apps/worker` (jobs and
events), `apps/admin` (CLI), `packages/domain` (pure business logic, most tests),
`packages/db` (generated types), `packages/integrations` (adapter interfaces and mocks),
`packages/config` (validated environment). Internal packages are consumed as TypeScript source.

**D-022 — Versions.** Next.js 16 (App Router; `proxy.ts` replaces middleware), React 19,
Tailwind 4, next-intl 4, Zod 4, supabase-js 2. **TypeScript 6** rather than 7 and **ESLint 9**
rather than 10, because the Next.js and typescript-eslint toolchains don't support the newer majors
yet. **Node 22 LTS** (supported until April 2027); move to Node 24 when convenient.

**D-023 — Business logic in `packages/domain` and in Postgres.** Schedule resolution, lesson
sequencing, roster cleaning and validation schemas are framework-free TypeScript shared by the web
app, the worker and future code. Multi-row writes that must be atomic (creating a class, checking
off a lesson, reordering lessons, alerts) are database functions.

**D-024 — Events: transactional outbox + graphile-worker.** Triggers call `app.emit_event()` in the
same transaction as the change (Phase 1 events: `class.created`, `class.deleted`,
`lesson.completed`, `lesson.progress_cleared`). The worker receives a Postgres notification, and
also sweeps every minute as a fallback, then fans each event out to one job per subscribed handler
with an idempotency key (`event:<id>:<handler>`), so one failing integration never blocks others.
Payloads carry ids only, never names. graphile-worker needs only Postgres, so it runs the same
hosted or board-hosted.

**D-025 — Integrations are interfaces with mocks only.** Paging/PA, VantageCore access control,
Akuvox intercoms, DW Spectrum video, SMS/email/voice. Temporary door credentials are limited to
one day by schema. Emergency functions (lockdown, roll call) are intentionally absent and need
their own design review.

**D-026 — Module entitlements are enforced in the app, not in RLS.** Licensing is a commercial
rule, RLS is a privacy rule; mixing them would make access bugs harder to reason about. Pilot
schools get core, teaching and library (`provision_school_defaults`).

**D-027 — Generated database types without Docker.** `tools/gen-db-types.ts` introspects Postgres
and writes the same shape as `supabase gen types typescript` (which needs Docker). CI regenerates
the file and fails if it drifted from the migrations.

**D-028 — Local development: Supabase CLI, with a Docker-free fallback.** The normal path is
`supabase start` (Docker). `tools/lite-stack` runs the same services from standalone binaries
(Postgres, Supabase Auth, PostgREST, Mailpit) on the same ports, for machines and sandboxes
without Docker. CI uses the Supabase CLI.

**D-029 — Container-first build; hosting decided in Phase 6.** Next.js builds a standalone server
for the board-hosted Docker image. Vercel now has a Montréal region, but the worker (and PDF
rendering in Phase 3) needs a long-running process, so hosted mode will need at least one small
container in a Canadian region anyway.

## Content and curriculum

**D-030 — Curriculum sample is paraphrased and flagged.** The seeded expectations are short
summaries (not official text) with `is_verified = false`, shown as "à vérifier" in the UI.
Licensing must be confirmed before loading official Ministry curriculum text into a commercial
product; the Catholic graduate expectations and the religion curriculum belong to Catholic
education bodies and need separate permission.

**D-031 — Library seed items move to Phase 4 (deviation).** The spec asked for 20–30 library items
in the Phase 1 seed. The item types' schemas are defined in Phase 4, so items written now would have
to be rewritten. All library tables, the review workflow statuses and access rules exist now.

**D-032 — Language levels are configurable and not an official scale.** Each board gets
Débutant, Intermédiaire, Avancé, Enrichi by default; boards can edit them and teachers can add
their own. Students can have a default level.

## UI

**D-033 — French UI, i18n from day one.** next-intl with `messages/fr-CA.json` (typed: a missing key
fails the build). No locale in URLs; the locale comes from a cookie, so English can be added by
providing `messages/en-CA.json`. Inclusive writing: neutral wording where possible ("la direction",
"la personne suppléante"), the middle dot only where unavoidable ("Enseignant·e").

**D-034 — Phone-first, accessible.** Tap targets are at least 44 px, bottom navigation on phones,
native pickers for dates, times and selects. Target: WCAG 2.0 AA (Ontario's AODA). The end-to-end
tests run axe on key pages and fail on serious violations.

**D-035 — Never lose a teacher's work.** Long text forms (lessons, pasted rosters) autosave a draft
to the device while typing and restore it after a crash or lost connection. Server errors keep the
form as typed. Checking off a lesson is optimistic with an "Annuler" undo.

**D-036 — Class pages are for the class's teaching team.** Principals and office staff don't get
the teacher screens; their oversight views come in Phase 6.

## Schema additions beyond SPEC section 8

`school_years`, `rooms`, `class_grades`, `school_cycle_anchors`, `unit_lesson_expectations`,
`library_item_grades`, `library_item_answer_keys` (answer keys in their own table so student-facing
code never reads them), `sub_sessions`, `class_session_results`, `strands` shared across grades,
`lesson_progress.taught_on` / `source` / `pending_confirmation`, `timetable_blocks.day_key` (instead
of weekday), `kind`, `teacher_id`, `room_id`, `notes`, and `unit_lessons.sub_notes`.
