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
_Amended in Phase 6 (2026-10-02):_ the name is `APP_NAME`, read by the server at run time, so one
image serves any install (D-113); `NEXT_PUBLIC_APP_NAME` is still read when `APP_NAME` is unset.

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
_Amended in Phase 6 (2026-10-02):_ board admins invite staff of their own board in « Conseil » («
Inviter une personne »), and the worker creates the Auth account; the inviter sends the sign-in
message from their own e-mail or texting app, and no invitation e-mail leaves our servers (D-107).
The CLI stays for the operator: the first board admin of a board, schools, deletions on request.
`pnpm admin invite` gives the account the `authenticated` role explicitly, and `invite` (for a
person whose access was removed) and `deactivate` go through `operator_set_staff_active`, so the
board's log shows the change with IP Lynx as the actor (D-106, D-107).

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
are tested (`supabase/tests/00_schema_invariants.test.sql`). _Amended in Phase 3:_ one more
way in, for substitutes only: a private schema run by a dedicated database role that the API
can never become (D-049). _Amended in Phase 4:_ library content is written only through
database functions (D-063). _Amended in Phase 5:_ a second private schema and role, for class
devices only: `class_portal`, run by `lynx_class_portal`, which executes five functions, reads no
table and is kept apart from the substitute portal's role (D-083); `anon` still executes nothing.
_Amended in Phase 6 (2026-10-02):_ the raw audit table is closed to the API and read only through
`list_audit_entries` (D-103); the worker also holds the service role for Auth's admin API, never the
web server (D-107); the operator's functions (`operator_*`, `log_operator_access`) are executable by
the service role only; colleagues read a profile's name, address, honorific, language and access
state, not the terms or checklist columns (D-109); and no personal value travels in an API query
string, which an ESLint rule enforces (D-119).

**D-013 — Who sees what (Assumption: to confirm with a board).**

| Role           | Sees                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Teacher        | Their classes (roster, schedule, planning, progress)                                                                |
| Principal / VP | Their school's classes, rosters and schedules, and alerts (read-only). **Not** teachers' units, lessons or progress |
| Office admin   | Their school's classes and schedules; no rosters                                                                    |
| Board admin    | Board configuration and schools; no student data                                                                    |

_Why:_ planning is the teacher's professional space; per-teacher progress visible to principals
reads as monitoring and would hurt trust (and may concern the teachers' union). Principal
oversight screens (absences, substitute-plan status) come in Phase 6. _Amended in Phase 3:_ a
released substitute plan is a hand-off document, which direction and office read (office sees
first names, never « Gestion de classe »), every view audited (D-056). _Amended in Phase 4:_
board admins have no special access to the library and no longer read teachers' private
library drafts; office staff have no library screens (D-065, D-078). _Amended in Phase 5:_
class mode belongs to the class team with a teacher role: principals and office staff never see
a teacher's sessions or kept class results (D-090), and the future audit viewer must not give the
direction a per-teacher view of `class_session.ended` (D-101). Opinions on resources are
anonymous to everyone, reviewers and the direction included (D-093).
_Amended in Phase 6 (2026-10-02):_ the direction's views exist: « Tableau de bord de la direction »
(D-102) and « Journal d'audit » (D-103), still without units, lessons, progress or per-teacher
tallies. Board admins read administrative and approval entries of the audit log only, never alert,
absence or substitute entries; they manage their board's staff, school contact details and bell
times, school years, reviewers, AI usage totals and feedback in « Conseil » (D-107, D-108, D-118),
and still see no student data.
_Amended for « Mon année » (2026-10-02):_ a class's year plan and its coverage (D-123, D-125) are
the class team's like its units: the direction, office staff and the board's admins never see a
unit's planned weeks, its attentes or a class's coverage, and there is no view of coverage across
classes or teachers. The long-range plan PDF (D-127) is the teacher's to hand over; the app sends
it to no one.
_Amended for « Info-parents » (2026-10-03):_ a class's weekly messages to families are the
class team's, like its planning: never the direction's, the office's or the board's (D-136).

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
- Visible to the class team and the school's direction. _Amended in Phase 3:_ a substitute with
  a valid session sees the covered classes' alerts on screen, hidden until tapped, every reveal
  audited, never on paper (D-056).

**D-017 — Audit log is append-only.** No foreign keys (the record outlives what it describes), no
updates, no truncation; deletes only when a retention job explicitly opts in. Audited in Phase 1:
alert reads/writes, alert switch on/off, role grants/revocations, class-team changes, class
deletion. Audit entries never contain student names or alert text.
_Amended in Phase 6 (2026-10-02):_ the log is read through one database function with a catalogue of
four audiences (`direction`, `direction_board`, `board`, `operator`); `select` on the table is
revoked from signed-in users; a guard trigger refuses free-text keys, strings over 120 characters
and details over 2 KB in every new row; exports are audited (`audit_log.exported`); and the nightly
retention job deletes rows after `auditDays` (730 by default) with the opt-in the immutability
trigger already allowed (D-103, D-105).

**D-018 — Proposed retention defaults (implemented as purge jobs in Phase 6).**

| Data                            | Retention                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| A class and everything in it    | Until the teacher deletes it (immediate, cascading), or end of school year + 1 year (proposed) |
| Audit log                       | 2 years                                                                                        |
| Dispatched outbox events        | 90 days                                                                                        |
| Class-mode responses            | Deleted when the session ends (unless the teacher keeps aggregate results, then 1 year)        |
| Substitute codes and sessions   | Expire the same day; deleted after 30 days (implemented, D-059)                                |
| AI usage ledger (metadata only) | 2 years                                                                                        |

_Amended in Phase 5_ (implemented now, in the worker, not in Phase 6; D-089, D-101): class-mode
answers and devices until the session ends (at most 2 hours, plus 5 minutes if nobody calls), join
failures a day, closed sessions without kept results 30 days, kept class aggregates
`classModeResultsRetentionDays` (365 by default); bulk runs and requests a year, what was sent 30
days (then only its SHA-256), runs planned but never started a day; staged pack imports a day;
opinions until the rater or the item is deleted; the keys of pack items deleted here as long as
the board. Deleted rows remain in database backups for the backup window (`docs/phase-5.md`).
_Amended in Phase 6 (2026-10-02):_ the purge jobs exist: the worker's nightly
`retention_maintenance`, with per-board settings the operator changes (`pnpm admin set-retention`)
within bounds of at least 365 days. A class's purge removes students' first names, levels, alerts
and the plans covering it a year after its school year, and keeps the teacher's units, lessons,
timetable, progress, « Fiche de suppléance » and kept class results (D-105). The defaults are
Assumptions pending a lawyer's review.

**D-019 — Login: 6-digit email code plus a "confirm" link.** The email contains both. The link
opens a page with a button that completes sign-in. _Why:_ board email security scanners
(e.g. Microsoft Safe Links) open links before the teacher does, which uses up one-time magic links;
scanners don't press buttons. Unknown addresses get the same response as known ones.

**D-020 — Roles.** All roles in the spec exist in the role model now (`app_role`: teacher,
principal, vice_principal, office_admin, facilities, board_admin, parent). School-scoped roles
require a school; board_admin is board-scoped. The substitute is deliberately **not** a user
account: Phase 3 gives them a single-day code (tables `sub_access_codes`, `sub_sessions` exist and
are closed to the API). _Amended in Phase 3:_ implemented as D-049 to D-051.

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
for the board-hosted Docker image. Vercel now has a Montréal region, but the worker needs a long-running process, so hosted mode
will need at least one small container in a Canadian region anyway. _Amended in Phase 3:_ PDFs
are rendered on demand in the web server's Node runtime, never stored (D-053).
_Amended in Phase 6 (2026-10-02):_ hosting is decided (D-114): hosted is Supabase Pro in Canada
(Central) plus one AWS Lightsail server in `ca-central-1` running Caddy, the web server and the
worker with Docker Compose; board-hosted is the same Compose plus a minimal self-hosted Supabase.
This is a deviation from SPEC §5, which named Vercel. `DEPLOYMENT.md` has both procedures.

## Content and curriculum

**D-030 — Curriculum sample is paraphrased and flagged.** The seeded expectations are short
summaries (not official text) with `is_verified = false`, shown as "à vérifier" in the UI.
Licensing must be confirmed before loading official Ministry curriculum text into a commercial
product; the Catholic graduate expectations and the religion curriculum belong to Catholic
education bodies and need separate permission. _Amended in Phase 4:_ the JSON import tool
exists, with a licensing gate (D-070). _Amended in the library expansion:_ the demo database also
loads a wider paraphrased sample for 3e and 5e, every row unverified (D-071).

**D-031 — Library seed items move to Phase 4 (deviation).** The spec asked for 20–30 library items
in the Phase 1 seed. The item types' schemas are defined in Phase 4, so items written now would have
to be rewritten. All library tables, the review workflow statuses and access rules exist now.
_Delivered in Phase 4:_ 29 original items as a content pack (D-071); 78 since the library
expansion.

**D-032 — Language levels are configurable and not an official scale.** Each board gets
Débutant, Intermédiaire, Avancé, Enrichi by default; boards can edit them and teachers can add
their own. Students can have a default level.

## UI

**D-033 — French first, with an English toggle.** next-intl with `messages/fr-CA.json` (typed: a
missing key fails the build) and `messages/en-CA.json` (a unit test fails if its keys or ICU
placeholders drift from the French file). French is the default for everyone. Anyone can switch to
English on the login page or in Profil; the choice is stored in a `locale` cookie and, when signed
in, in `users.preferred_locale`, which is applied again at the next sign-in on any device. No locale
in URLs. Only the interface is translated: what staff type (lessons, units, events, names) is shown
as typed. Reference labels with an English column (subjects, language levels) follow the interface
language; curriculum strands stay French. Times read "8 h 45" in French and "8:45 a.m." in English.
The login email stays in French for now (the auth server sends one template). Inclusive writing:
neutral wording where possible ("la direction", "la personne suppléante"), the middle dot only where
unavoidable ("Enseignant·e").
_Amended for « Info-parents » (2026-10-03):_ the sentences a message to families is drafted
with come from both catalogues whatever the interface's language (`newsletterText`: French from
`fr-CA.json`, English from `en-CA.json`), since the message goes out in both (D-136, D-137).

**D-034 — Phone-first, accessible.** Tap targets are at least 44 px, bottom navigation on phones,
native pickers for dates, times and selects. Target: WCAG 2.0 AA (Ontario's AODA). The end-to-end
tests run axe on key pages and fail on serious violations.

**D-035 — Never lose a teacher's work.** Long text forms (lessons, pasted rosters) autosave a draft
to the device while typing and restore it after a crash or lost connection. Server errors keep the
form as typed. Checking off a lesson is optimistic with an "Annuler" undo.

**D-036 — Class pages are for the class's teaching team.** Principals and office staff don't get
the teacher screens; their oversight views come in Phase 6.
_Amended in Phase 6 (2026-10-02):_ the oversight views now exist for principals and vice-principals:
« Direction » (`/direction`) and « Journal d'audit » (`/audit`), D-102 and D-103. Class pages stay
the teaching team's.
_Amended for « Info-parents » (2026-10-03):_ « Info-parents » is a class page of the teaching
team too (D-136).

## AI (Phase 2)

**D-037 — AI runs in the worker, never in the browser or the web server.** A request is a row in
`ai_jobs`, created by `request_ai_job()` (checks role, the school switch, the budget and a rate
limit: 3 open requests and 40 per hour per person, counted in `ai_request_log`, a log with no
content and no API access, so discarding a finished job does not give a request back). Requests
from one person are handled one at a time. The worker runs it, holds the only copy of the provider
key, and is the only writer of `ai_generations` (tokens, cost, latency, prompt version, model,
provider request id: the API's `request-id`). The page polls the job less often as time passes (up
to every 10 s), pauses in hidden tabs, keeps trying after errors and stops after 15 minutes with a
message. Long calls never block a web request, and usage records cannot be forged or deleted
through the API. _Amended in Phase 5:_ bulk generation runs in the worker too
(`library_bulk_tick`), one Message Batches API batch per run the operator plans; its requests
live in `library_bulk_requests`, not `ai_jobs`, outside school budgets and per-person limits, under
a hard cost cap per run (D-095, D-096, D-098). Class mode never uses AI (D-082).

**D-038 — Nothing personal leaves Canada.** Every request is treated as leaving the country, so
before any call (`packages/ai/src/privacy.ts`):

- Every student and staff member of every school where the requester holds a role, the
  board-level staff of those boards, everyone in a board the requester administers, and the
  requester become a marker (« Élève A », « Adulte B »). The worker's list is never narrower than
  what the teacher's preview uses.
- Names are matched with or without accents (also ł, ø, æ, œ...), in any case and in any
  alphabet. Staff are also matched by honorific and any part of their name (« Mme Tremblay »,
  « Madame Isabelle »), by a part alone, and by each half of a compound name (« Mme Gagnon »,
  « Roy » for Anne Gagnon-Roy). Names that are everyday words (Pierre, Claire, Aimé; staff
  surnames such as Côté, Parent, Plante) are matched only when capitalized or after an honorific.
  Particles (de, du, des, la, le, d', saint, van...) are never a name on their own: they stay with
  what follows (« De Grandpré », « La Salle »), and the part after them (« Salle », « Amour » in
  D'Amour) is matched alone only when capitalized. Particles and parts shorter than three letters
  (« Lê », « Au », « Tạ ») are matched alone only after an honorific (« Mme Lê »), so a staff
  member's name can't turn « de », « la » or « au » into a name everywhere.
- Text is normalized before any check (invisible characters removed, hyphens inside words made
  plain), and the normalized text is what is sent.
- Emails, phone numbers, long identifiers (OEN, health card), postal codes, street addresses in
  French or English order, and a child's birth date (a date near « née », « anniversaire »,
  « born »..., in French or English order, or a record-style date with a recent year and any
  separator) block the request. It is not "cleaned up", the teacher removes them.
- A final check runs on the exact outbound text and refuses to send if a name or detail remains.
  It normalizes its own copy and also looks for names split by punctuation.
- Requests carry no user, school, board or account identifiers.
- The teacher sees exactly what will be sent before sending (names highlighted), and can open
  the exact text that was sent afterwards. _Amended in Phase 3:_ for a substitute plan, a field
  holding a personal detail is left out and listed in the preview instead of blocking the whole
  request (D-052).
- Names come back only on our servers: students with the roster spelling, staff as the teacher
  wrote them. A name that could be several people, or a staff name written in lowercase, gets its
  own marker and comes back exactly as written. Marker-like text already in the teacher's input
  (« l'élève A ») is never given to a person and never turned into a name. Known limits: a name
  the app doesn't know (a parent, a sibling, a student from a school where the teacher doesn't
  work) can only be caught by the teacher at the preview; a historical figure who shares a
  student's first name (« Samuel de Champlain ») is replaced too, then restored.
- _Amended in Phase 4:_ library requests are built by the database from ids, and reusable
  library content may contain no marker, so no name can come back into it (D-072).
- _Amended in Phase 6 review (2026-10-02):_ the rule stays the goal, and every text now states its
  limit instead of "every name": `PRIVACY.md`, the README, the demo script, the AI annex
  (`docs/ai-data-flow.md`) and the texts teachers accept (« Bienvenue », the notice's « L'intelligence
  artificielle ») say that the app replaces the names it knows (the students and staff of the
  teacher's schools, the staff of their boards) and that a name it does not know must be removed by
  the teacher at the preview. A unit test pins the limit (`packages/ai/src/privacy.test.ts`: a
  parent's and a sibling's names go out unchanged, with nothing blocked), so no text can promise more
  again without someone noticing.

**D-039 — AI is off until the direction turns it on, and a board can forbid it.** Per-school
switch on the École page (principal or vice-principal, audited). `boards.settings.ai.allowed =
false` turns AI off for every school of a board, whatever its principals chose.
_Amended in Phase 6 (2026-10-02):_ board admins may also turn AI on or off for a school of their
board, on the school's page in « Conseil » (« Normalement décidé par la direction de l'école »), for
beta schools without a direction account (D-108, Assumption). The alerts switch stays the
direction's.

**D-040 — Budgets in provider dollars, pooled per board.** Amounts are the provider's cost in US
dollars per calendar month (school time zone), not the price charged to boards. Each school gets
an allowance (its `ai_budgets` row, else the board default, else 50 USD). A school can always use
its own allowance; past it, when pooling is on, it can borrow what the board's other AI-enabled
schools haven't used, up to its ceiling (default 2x the allowance). So a board can go over its
pool by at most what was borrowed, which shows on the monthly report. The check runs when a
request is made and again when the worker starts it, so only calls already running can go
slightly over. Failed calls cost money and are counted. The operator sets budgets with
`pnpm admin set-ai-budget` / `set-ai-board` and bills from `pnpm admin ai-usage --csv`. Payment
collection comes later (Phase 6). Board AI settings (`boards.settings.ai`, including `allowed`)
and `ai_budgets` are operator-only: a trigger refuses changes to `settings.ai` from API users, and
values outside the app's bounds (allowance 0–100 000, multiplier 1–10) are refused for everyone.
_Amended in Phase 6 (2026-10-02):_ board admins see the month's usage per school in « Utilisation de
l'IA » (with a CSV), through `board_ai_usage`; usage rows are readable by their author only (D-104).
Budgets stay operator-only. Payment collection is still not built: billing stays on `pnpm admin
ai-usage --csv`.

**D-041 — Model, prompts and quality.** Default model Claude Opus 5.5 at medium effort (chosen by
the product owner for the beta), both configurable (`AI_MODEL`, `AI_EFFORT`) with prices in
`packages/ai/src/pricing.ts` or `AI_PRICE_*`. System prompts are versioned files
(`prompts/<feature>/<version>.md`); the version is stored with every generation and saved item.
Answers use structured outputs and are validated with Zod plus feature checks (every level once,
sizes, no level name in a title), with up to three attempts; refusals and cut-off answers are not
retried. `pnpm ai:eval` runs 10 fictional cases with automatic checks and writes a report for a
teacher to read; run it before any prompt change. A fake provider answers locally for
development, CI and demos. Other providers (a board's own cloud account, a local model) plug into
the same `AiProvider` interface when a board asks; only Anthropic and the fake exist now.
_Amended in Phase 4:_ a feature may choose its output schema per input, normalize form before
validating, and send only its section of a prompt (D-080). _Amended in Phase 5:_ the batch path
uses the same feature, prompt version, schemas, checks and `max_tokens` as on-demand generation,
priced at the batch rate (half); `pnpm ai:eval --batch` runs the cases as one batch; no system
prompt may hold a fixed first name, which a test checks with the demo people (D-098).

**D-042 — Texte différencié.** The teacher pastes a text, instructions or an activity, picks the
grade, subject and levels (2 to 6), checks the preview and sends. Every version is editable (title,
text, glossary, questions, visual supports, teacher note). Printouts put each level on its own page
with no level name on it, only a small number for the teacher, so no student sees themselves
labelled « Débutant ». Results are saved as private library drafts (source `ai_generated`, prompt
version, model), one version per level plus the original text as the base version. Teachers can add
levels of their own; board levels are changed by the operator for now. _Amended in Phase 4:_
saved texts are ordinary library items (D-073).

**D-043 — AI data retention.** `ai_jobs` (the teacher's input, the answer and the exact text sent)
are deleted after 30 days (`AI_JOB_RETENTION_DAYS`); saved drafts stay in the library. Usage
records in `ai_generations` hold no text and are kept. The request log (`ai_request_log`: job id,
user id and time, no text) is deleted after one day.
_Amended in Phase 6 (2026-10-02):_ usage records in `ai_generations` are deleted after `aiUsageDays`
(730 days by default, at least 365) by the nightly retention job (D-105).

**D-044 — Drafts are kept per person and survive a failed AI request (amends D-035).** Long text
forms (lessons, pasted rosters, AI requests and results) save a draft on the device once the
teacher edits them, never a copy of what was merely opened. Drafts are keyed by user, so another
account on a shared computer never sees them, and signing out removes every draft from the
device. A draft edited from an older saved version is offered, not restored over newer content.
The text of an AI request is kept until the request succeeds, and a failed request offers
« Reprendre ce texte ».
_Amended for « Commentaires de bulletin » (2026-10-03):_ report card comments (« Bulletins »)
are drafts with stricter rules (D-130): kept in template form (`{prénom}`, never a first name),
removed when another account signs in on the browser and 60 days after the report goes home, a
failed write said in words, nothing written after a sign-out in the page.

**D-045 — AI calls fit in a time limit (amends D-041 and D-042).** Answers are streamed with
`max_tokens` 64 000 (thinking counts toward it). A job has 13 minutes in all, under the 15 minutes
after which maintenance fails a stuck job. Refusals, cut-off answers and timeouts are not retried,
and an abandoned or broken call is still counted: with the input the API reported and, since the
API counts output only at the end of an answer, an estimate of its output (the larger of the text
received and about 100 tokens per second of generation, at most `max_tokens`). To finish in time, the
form refuses a text longer than 30 000 characters divided by the number of levels (12 000 for 2
levels, 5 000 for 6). `pnpm ai:eval` has an eleventh case at that largest size. Server-side
refusal fallbacks (a beta) stay off: they would bring in another model and its price (D-041).

**D-046 — What staff see on the AI screens (amends D-039 and D-042).** Staff screens show AI as
turned off by the board when the board forbids it. Student copies are in French, the content's
language, whatever the interface language. A personal level used by a request or a saved text
can't be deleted, only turned off; a result whose level was deleted since is saved without that
version, with a warning. _Amended in Phase 4:_ no level that a library version uses can be
deleted, board levels included (it used to become a second base version); a level removed with
its owner or its board takes those versions with it (D-063).
_Amended in Phase 6 (2026-10-02):_ no screen or API shows who used AI how much: rows are the
author's only, and the direction and board admins get totals (D-104).

## Substitute hand-off (Phase 3)

**D-047 — Plans are built in the publish request; the worker keeps them current; release is
computed.** « Envoyer » reads the plan's sources as the teacher (`get_sub_plan_sources`, only
what RLS already lets her read), builds every school day with the pure `buildAbsencePlans()`
(`packages/domain`) and saves the absence and all its plans in one transaction
(`publish_absence`). A day whose build throws gets a minimal plan (schedule, routines,
contacts) with the warning `generation_failed`, so publishing never fails because of the
builder and 6 a.m. never waits on a background job. Afterwards, row triggers on everything a
plan is built from (progress, units, lessons, timetable, roster, calendar, rotation anchors,
school settings, class team and teacher roles, the Fiche) mark the teacher's upcoming published
absences (`absences.sources_changed_at`) and emit `absence.sources_changed` the first time; a
later change moves the mark. The worker's `sub_plan_refresh` rebuilds with the same loader
(`app.sub_plan_sources`) and builder and saves with compare-and-set (three tries, then the job
is retried). The web server's own rebuilds (publish, « Modifier », « Mettre à jour le plan »)
send back a fingerprint of the sources they read: if the sources changed in the meantime, the
plans are saved all the same and the absence stays marked for the worker. A plan is
_refreshable_ while its absence is published, no substitute has signed in, and its date is
later, or today before release; after that it is a fixed snapshot. Multiple days continue one
lesson sequence; lessons of fixed days, and of the teacher's other absence in the week before
(back-to-back absences), count as taught until their report arrives. When the lessons an
absence assigns change, the teacher's absences starting in the following week are woken with
an event (`cause: 'earlier_absence'`) rather than marked, so a write never locks two absences.
Confirming a report also rebuilds. A plan counts as released when released by hand or when
`status = 'ready'` and `review_deadline` (the board's `subPlanAutoReleaseTime`, default 07:30,
school-local) has passed: no job runs at 07:30. _Why:_ the flagship moment must not depend on a
worker; plans must follow what the class actually did. The worker depends on `@lynx/domain`;
the `pending`, `generating` and `failed` plan statuses stay unused (check constraint).
_Amended for « Mon année » (2026-10-02):_ an update of a unit marks the absences only when a
column plans read changes (`class_id`, `subject_id`, `title`, `status`; a `when` clause on
`units_flag_absences_update`), so a planned window, a description or unit attentes saved never
make a plan « updated » for nothing (D-123).

**D-048 — A plan is three layers keyed by timetable block; the database never trusts ids in
plan JSON.** `sub_plans.plan` is the generated layer (`subPlanV1Schema`), `edits` the teacher's
overlay, `ai` the AI layer (3b). Blocks are keyed by `timetable_blocks.id` and each edit or AI
entry records the lesson it was written for: `composeSubPlan()` applies teacher edits, then AI,
then the template, per block and only while the block keeps that lesson. Edits that no longer
match are shown to the owner as detached and hidden from everyone else; rebuilds never touch
edits. Everything that grants access is derived by the database: the covered classes
(`sub_plan_classes`, a subset of the teacher's classes), the roster (active students of those
classes), the lessons a report may name, and the school, office phone and teacher name, read
from tables when the plan is shown. _Why:_ JSON sent to a definer function must never make it
return someone else's data. _Amended in Phase 4:_ a block may carry a snapshot of a library
resource, never its key (D-077).

**D-049 — The substitute portal is a private schema run by a dedicated role (amends D-012).**
Substitutes have no account and their browser never calls the API. The web server calls the
five functions of schema `sub_portal` (`redeem`, `load`, `alerts`, `save_report`,
`end_session`), which PostgREST does not expose, over its own connection
(`SUB_PORTAL_DATABASE_URL`, a pool of at most 3) as the role `lynx_sub_portal`. The role can
execute those functions and nothing else: no table privileges, no public or app function,
`statement_timeout` 5 s, never granted to `authenticator`. The migration creates it `NOLOGIN`;
the operator gives it `LOGIN` and a secret password (the seed sets a local-only one). Every call
re-checks the session, its code, the day's window, revocation, the absence's status and the
Teaching module. `anon` still executes nothing and `authenticated` cannot call the portal.
_Why:_ anon-executable functions would let anyone with the public key call them and choose
their own throttle keys; minting JWTs would put the JWT secret (which can mint `service_role`)
in the web server; the service role would bypass RLS. One more secret and one more connection;
on hosted Supabase the pooler user is `lynx_sub_portal.<project-ref>` (docs/phase-3.md).

**D-050 — Access codes: 10 characters, a keyed hash, one day, 2 codes × 2 devices.** Ten
Crockford Base32 characters (50 bits, `XXXXX-XXXXX`), typed as read over the phone (lowercase,
spaces, hyphens, O for 0, I or L for 1). The web server sends `HMAC(SUB_CODE_HMAC_KEYS, code)`;
the database stores its SHA-256, so a dump cannot be brute-forced without the key; a lookup
sends one MAC per key of the ring (current and previous). A code works only on its plan date,
within the school's access hours (`accessFrom`/`accessUntil`, default 05:00–18:00, computed in
SQL in the school's time zone), at most 2 active codes per plan and 2 devices per code. A code
typed before its window answers « Ce code sera valide le … à partir de … » and is not counted as
a wrong guess. The day's access ends when the last code issued for it expires (or at the end of
the access hours if none was issued), so a settings change during the day does not move it. A
device is the SHA-256 of a random HttpOnly cookie, the same across key rotations; the network is
an HMAC of the client address with the current key. Each code records who issued it and in what
role. The plaintext exists only in the response to the person who issued it: nobody can look a
code up later. _Why:_ typed from paper at the office door; even with no throttling, 1,000
guesses a second for 13 hours against 50 active codes succeed with probability about 2·10⁻⁶.

**D-051 — Throttling, revocation and audit for substitute access.** Each failed attempt is
stored with the device and network keys only (no raw cookie or address). Delays instead of a
lockout: per device after 5 failures in 15 minutes (30 s, doubling, at most 15 minutes); per
network after 50 (5 s, doubling, at most 60 s, so one student cannot lock out the school's
Wi-Fi); and, whatever the client sends, past 300 failures a minute across all devices and
networks everyone waits a minute. Nothing is recorded while waiting, and `redeem` never raises
after recording. The client address is the entry `TRUSTED_PROXY_HOPS` from the right of
`CLIENT_IP_HEADER`: production must sit behind a reverse proxy that appends it
(docs/phase-3.md); reached directly, a client can choose its address and drop its cookie, and
only the global cap and the 50-bit code remain. Staff cut a code, one device, or all access;
cancelling or shortening the absence cuts it too; every call re-checks, so it takes effect at
once. A device that was cut stays out, and its code takes no new device (a private window or
cleared cookies cannot take the free slot). Audited, with school and board: `sub_code.issued`,
`sub_code.revoked`, `sub_session.revoked`, `sub_code.redeemed`, `sub_session.ended`,
`sub_plan.viewed` (once per session per content version), `sub_plan.printed`,
`sub_plan.released`, `student_alert.viewed` (every reveal, per class), `sub_report.submitted`,
`sub_report.viewed`, `sub_report.confirmed`, `absence.published`/`updated`/`cancelled`. The
substitute's entries name the code's issuer and the issuer's role. Throttling goes to the web
server's warning log with a short prefix of the hashed keys; it belongs to no school.

**D-052 — The deterministic plan comes first; AI is an optional, previewed step (amends
D-038).** Without AI a plan has the day's schedule and routines, the next lessons from the
teacher's planning, groups by level with each level's description, the Fiche, contacts, the
end of day and a faith moment; it works with AI off. Deviation from SPEC §9.4.3–4: nothing
comes from the library until Phase 4 (it is empty, D-031); « the matching version of each
activity » is groups plus level descriptions now, AI instructions per group in 3b, library
versions in Phase 4. « Consignes détaillées (IA) » is never automatic: the teacher opens a
preview of exactly what would be sent; a text field holding a personal detail (phone, email,
identifier...) is left out and listed as « Non envoyé » instead of blocking the whole request
(the D-038 amendment); the editor's pending changes are saved before the preview, and a plan
changed since the preview is refused (`LXS15`) and previewed again. Never sent: student names
(groups go as sizes, per period), alerts, « Gestion de classe », the absence note, reports,
class, school or staff names, and ids. The answer (`max_tokens` 64 000, D-045) is applied by a
trigger when the worker records it, never once a substitute has opened the plan; the teacher
can remove it at any time, even during the day. _Amended in Phase 4:_ plans use reviewed,
sub-friendly library resources, with each group's version (D-077).

**D-053 — PDFs are rendered on demand, never stored, never with alerts (amends D-029).** The
plan PDF (schedule, lessons and steps, groups with first names, contacts, end of day, faith
moment; « Alertes : consultez l'application ou la direction » instead of alerts; never
« Gestion de classe ») and, in 3b, « Activités pour les élèves »: one page per group per activity,
only the group key in a corner, names and level names replaced by « … », always in French.
Rendered with `@react-pdf/renderer` in the web server (`runtime = 'nodejs'`, `no-store`), in
vendored Noto Sans (SIL OFL). Opened through plain links (never prefetched); `?download=1` asks
for a download on success, never the `download` attribute, and a failure is a small page with a
way back. Prints by anyone but the owner are audited as `sub_plan.printed`. The document
language is French. _Why:_ no Storage in CI or the lite stack; stored PDFs go stale after
edits; alerts on paper cannot be audited (SPEC §6).
_Amended for « Mon année » (2026-10-02):_ « Plan à long terme » (D-127) follows the same rules:
rendered on demand in the web server (`runtime = 'nodejs'`), never stored, `private, no-store`, a
path ending in `/pdf` (no page security policy), opened through a plain GET form (never
prefetched), `?download=1` to save it, a failure page with a way back to « Mon année ». It holds
no student data and no alert, and it is not audited: it is the teacher's own planning.

**D-054 — The end-of-day report writes pending progress; the teacher confirms through one
path.** The report autosaves to the server during the day and to the browser tab
(`sessionStorage`), tied to the device session that started it; the office can cut that session
to let another device take over. Sending writes, for each lesson « Terminé »,
`lesson_progress(pending_confirmation, substitute_report, taught_on = plan date)` without
overwriting the teacher's own record; sending again replaces them. « En partie » and « Pas
fait » write nothing, so those lessons stay next. Free text is encrypted by the web server with
the alerts key ring, bound to the plan; outcomes and absent-student ids stay plain and are
checked against the plan's classes. A report never sent becomes readable to the teacher once the
day's access ends. Confirming goes only through `confirm_sub_report`, which is refused if the
report changed since the page showed it (`LXS16`); « Pas terminée » removes the report's record
of the lesson whatever its status. Aujourd'hui and Planification show pending lessons with a link
to the report, never a check-off. No report at all: « Marquer les leçons prévues comme données ».
Free text and the absent list are purged 60 days after confirmation (or after the plan date).

**D-055 — What a plan covers.** Every date of the absence that is not a weekend, PA day or
holiday; absences start today or later and last at most 14 days (Assumption: long-term
assignments are out of scope). Covered blocks: the teacher's own, plus unassigned blocks of her
homeroom classes (duty and prep included); blocks of her homeroom taught by someone else become
a hand-over (« EPS avec M. Leblanc (Gymnase) »). Calendar effects follow D-008: a replaced block
shows the event and gets no lesson, interrupted and shortened blocks keep the lesson, cancelled
blocks go and the end of day moves. Rotating-day schools show « Jour N »; an unknown cycle day
gives no blocks and a warning. Half days split at the school's `halfDaySplit`, else the first
lunch, else the nutrition break nearest midday (flagged as guessed); the other half's blocks are
still sequenced. Co-homeroom classes list the other homeroom teacher as a contact (Assumption).
_Amended in Phase 6 (2026-10-02):_ sample classes (« Classe exemple », D-109) are never covered:
`app.teacher_class_ids` leaves them out, so they never reach a plan, a code or the plan-source
check, and the absence form says so.
_Amended in Phase 6 review (2026-10-02):_ a plan day covers only the classes whose school year
includes it. `app.sub_plan_sources` takes the teacher's classes whose year overlaps the plan's dates
and gives each its `yearStartsOn` and `yearEndsOn`; the builder skips a class on a day outside its
year (`classesOn`); « Aujourd'hui » (`loadToday`) does the same. A class a teacher keeps from an
earlier year (its timetable stays after the year-end purge) is never in a later plan. Changing a
year's dates refreshes the plans of its classes' teachers (`school_years_flag_absences`).

**D-056 — Who sees what for the substitute hand-off (amends D-013 and D-016).** A released plan
is a hand-off document; the teacher's units and progress otherwise stay private.

| Data                        | Absent teacher                  | Principal / VP            | Office                                           | Substitute (valid session, that day)                 |
| --------------------------- | ------------------------------- | ------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Absence (dates, part, note) | read; changes through functions | read                      | read                                             | the note, in the released plan                       |
| Plan status, codes, devices | read, issue, cut, release       | read, issue, cut, release | read, issue, cut, release                        | none                                                 |
| Plan content, first names   | read and edit                   | released only, audited    | released only, audited, no « Gestion de classe » | released only, audited once per version              |
| Alerts                      | `get_class_alerts` (audited)    | `get_class_alerts`        | never through their own screens                  | on screen, hidden until tapped, every reveal audited |
| PDF                         | yes                             | released, audited         | released, audited                                | yes, audited                                         |
| Report                      | read and confirm                | read, audited             | status only                                      | write their own, tied to one device                  |
| « Fiche de suppléance »     | class team reads and writes     | through the plan          | through the plan                                 | through the plan                                     |

Other staff and board admins see none of it. Office seeing first names in a released plan is a
narrow, audited exception to « office: no rosters » (question 1 for Mike). A code is a bearer
credential: whoever holds it, the staff member who issued it included, sees what a substitute
sees, alerts included. Office staff could redeem a code they issued themselves; the audit trail
names the issuer and the issuer's role on the redemption, every view and every alert reveal, so
such a session is visible (the Phase 6 audit viewer should flag it). The absent teacher is the
plan's owner only while she holds a teacher role at the school, and issues codes only for
classes she still teaches; a change to her roles or classes rebuilds her refreshable plans.
_Amended in Phase 6 (2026-10-02):_ the audit viewer flags a substitute's entry whose code the office
issued (`issued_by_role = 'office'`) with « Code émis par le secrétariat », for the school's
direction (D-103). Board admins see none of the substitute or alert entries in the log either.

**D-057 — « Fiche de suppléance » per class.** `class_sub_profiles` holds arrival, routines,
class management, dismissal, fallback activities and a neighbouring colleague (an active teacher
at the school) with a note. Only the class team reads and writes it; « Gestion de classe » is
left out of the office view and every PDF and is never sent to AI. No emergency field: school
procedures live in `schools.settings.substitute.emergencyInfo` (the direction's « Suppléance »
card, with access hours, arrival instructions and the half-day split), so there is no second,
weaker store for medical information. _Why:_ SPEC §9.4.4 asks for routines, contacts and
end-of-day instructions, and no table held them.

**D-058 — Catholic connection in plans.** `absences.catholic_connection` (default on,
remembered on the device) adds one « Moment de foi », picked deterministically from active
`catholic_references` of the board (the board's own first): the grade range covers the classes,
the season matches or is empty (Advent, Christmas, Lent, Easter by computus, ordinary time),
tags overlap the day's lessons best, ties rotate by date. The teacher edits or removes it; AI
(3b) may add one sentence linking it to the day's topic. _Amended in Phase 4:_ the ranking is
shared with library generation (D-074).

**D-059 — Retention and deletion (amends D-018).** Codes and sessions are deleted 30 days
after they expire, throttle attempts after 1 day, report free text and the absent list 60 days
after confirmation (or after the plan date if never confirmed): the worker's daily
`sub_access_maintenance`. Plans and structured reports are kept 1 year after the plan date
(Assumption; the purge job comes in Phase 6). Deleting a class deletes every plan covering it,
with its codes, sessions, report and the report's pending progress (audited
`sub_plan.deleted`); deleting a teacher removes her absences. No phone number or email address
of a substitute is ever stored: « Texto » and « Courriel » open the sender's own apps.
_Amended in Phase 6 (2026-10-02):_ plans and structured reports are purged a year after the plan
date (school-local), and absences with no plan left after the same delay, by the nightly retention
job (`subPlanDays`, 365 to 1,095 days; D-105). The 60-day purge of report free text is unchanged and
goes to the lawyer with the other minimums.

**D-060 — Events, integrations and licensing.** Events carry ids, dates and the part of day
only: `absence.published`/`updated`/`cancelled`/`sources_changed` (with `cause` when an earlier
absence caused it), `sub_plan.ready` (on creation), `sub_plan.released` (by hand only),
`sub_session.started`, `sub_report.submitted`/`confirmed`; 3b reuses `ai.job_requested`. The
log-only `access_control_substitute_credential` handler on `absence.published` stays; Phase 3
makes no integration calls. Everything belongs to the Teaching module: pages and actions check
it in the app, and the portal, publishing and codes check it in the database too.

## Content library (Phase 4)

**D-061 — One versioned Zod schema per item type, in the pure package `@lynx/content`
(Assumption on the field choices).** `packages/content` (Zod only) holds the catalogue (6 buckets,
25 types and each type's flags), one content schema per type built from shared blocks, answer
keys, the student projection, grading, the document model, readiness, the conversion of AI
output, French typography checks, the seed pack format and curriculum-import validation. Content
is stored in `library_item_versions.content` with `schema_version = 1`. Each schema is written
once and built in three modes: `draft` (maximum lengths, strict objects that refuse unknown keys,
empty values allowed; used on every save), `final` (minimums, maximums and cross-field rules;
needed to mark an item reviewed) and `ai` (the same fields with no enum, literal, pattern or size
constraint, one flat question object with nullable per-kind fields, everything required but
nullable). Every version also has a `title` (empty: the item's), an `objective` (« Intention
d'apprentissage ») and a `teacherNote`. _Why:_ one definition gives the same rendering, editing,
AI validation and seed checks; strict objects stop answers from slipping into student content;
draft mode keeps unfinished work (D-035); the API's structured outputs do not enforce enums or
sizes, and a violation would fail with no path and cost a paid retry, so the `ai` mode leaves
them to `normalizeAiContent` and to `validate`, which reports paths. A new field needs schema
version 2 and a conversion. `@lynx/ai`, `@lynx/domain` and the apps depend on `@lynx/content`,
never the reverse.
_Amended by « Commentaires de bulletin » (2026-10-02):_ 26 types: the comment bank `report_comments` (D-129) is
the 26th, in « Évaluer ». `TYPE_INFO` gains `teachingMaterial` (false only for the bank: no
duration, materials or formats) and `aiGenerator` (`library_item`, or the bank's own feature);
`LIBRARY_ITEM_AI_TYPES` lists the 25 types « Créer avec l'IA » writes.

**D-062 — Answer keys stay in their own table and reach staff views only.** Every question has
an id (`^[a-z][a-z0-9]{0,7}$`) and its answer lives in `library_item_answer_keys.answer_key`
(`{answers: [{questionId, kind, …}], solution}`). Question kinds: multiple choice (one or several
correct choices), true or false, matching (extra right-hand items allowed), ordering and short
answer (a sample answer and accepted answers). Ordering items and matching right-hand columns are
stored in display order, scrambled deterministically, so the stored order never gives the answer
away. `gradeQuestion` scores all or nothing for multiple choice, true or false and ordering, and
one point per pair for matching; a short answer is correct only when it matches an accepted answer
after normalization, otherwise it is left to the teacher (« Correction manuelle »). Student
loaders, `renderStudentDoc` and `studentContent` take no key and never read the key table.
Substitute plans never carry keys (Assumption): their snapshots hold none and the owner's plan
links to the item, so office staff and substitutes never receive one. Staff who can read an item
can read its keys through the API (they are not personal data). _Why:_ SPEC §9.3 and §11; a rule
enforced by table and by function signature can be tested.

**D-063 — Library content is written only through database functions (amends D-012).**
`authenticated` keeps `select` on the library tables and the author's `delete` of drafts,
sent-back and archived items; it has no `insert` or `update` on `library_items` and no write on
versions, answer keys, grades, attentes, item tags, tags or reviewer designations
(`00_schema_invariants` checks it). The writers are `save_library_item`, the workflow functions
below, `add_library_item_to_unit`, `save_ai_job_to_library`, the AI result trigger and the seed.
`save_library_item(item, expected_revision, item_json)` checks everything itself: a new item's id
is picked by the client and kept in its device draft, so a create sent again returns the same
item; later saves send the revision they were edited from and are refused when it moved on
(`LXL07`); every version the item keeps is sent with its key; links (subject, grades, attentes,
tags, Catholic reference, levels) must be in the item's board, attentes of its subject and grades.
Every content change goes through `app.library_content_changed`: the revision goes up, a pending
approval request is cancelled, an earlier faith review no longer counts, a reviewed item shared
with the whole board that now needs a faith review goes back to its school (or private, D-064),
the search document is rebuilt, and the upcoming absences whose plans may use a reviewed item are
marked out of date. The editor says so before such a save (« En attente d'approbation », a faith
review, board-wide faith content), asks once, and never sends a form without changes.
Status changes:

| From                                 | Function                                                            | To                                                  | Who                                       |
| ------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| draft, sent back                     | `library_mark_reviewed(item, originality_confirmed)`                | reviewed                                            | editor¹                                   |
| reviewed                             | `library_return_to_draft(item)`                                     | draft, private, request cleared                     | editor                                    |
| reviewed                             | `library_share(item, scope, school, names_confirmed)`               | private, school or board                            | author                                    |
| reviewed                             | `library_request_approval(item)`, `library_cancel_request(item)`    | sets or clears the request                          | editor                                    |
| reviewed and requested               | `library_decide(item, 'approve' or 'reject', note, revision)`       | approved (board-wide), or sent back (private, note) | content reviewer, never on their own item |
| reviewed and requested, faith review | `library_faith_decide(item, 'approve' or 'reject', note, revision)` | faith-reviewed, or sent back                        | faith reviewer, never on their own item   |
| any but approved or archived         | `library_flag_faith(item)`                                          | faith content flagged                               | a reviewer who can read the item          |
| shared or approved                   | `library_retract(item, note)`                                       | sent back, private, approval cleared                | content reviewer of the board             |
| any but archived                     | `library_archive(item)`                                             | archived, private, approval cleared                 | keeper²                                   |
| archived                             | `library_restore(item)`                                             | draft                                               | keeper²                                   |

¹ The author while she holds a role other than parent in the item's board; for the board's own
items (`board_created`, no author), a content reviewer of the board, while the item is a draft,
reviewed or sent back. Sharing beyond herself also needs that role; an author who left the board
keeps reading her items and can make them private, nothing more. ² The same people whatever the
status.

Approved items are read-only for everyone (`LXL06` for their author): to change one, a reviewer
withdraws it or its keeper archives it (remix comes in Phase 5). « rejected » is shown as
« À retravailler ». Structured safety notes replace the Phase 1 check (D-067). Errors the app
translates: `LXL01` not ready (the detail names what is missing), `LXL02` safety notes, `LXL03`
faith review first, `LXL04` wrong status, `LXL05` own item, `LXL06` approved items are read-only,
`LXL07` changed since it was opened, `LXL10` versions for personal levels (`LXL08` and `LXL09` are
the AI's, D-072, D-073). _Why:_ status and content rules are enforced and audited in one place
(SPEC §6, content approvals); direct writes would go around them. _Amended in Phase 5:_ more
writers, each a database function: `remix_library_item` (« Adapter », D-092; the way a teacher
changes an approved item, her own included), the bulk worker's `app.library_item_from_bulk` and
the reviewers' `library_approve_board_draft` (D-095), and the pack import `content_pack_apply`
(D-100). Deleting a board item is audited by a trigger, whoever deletes it
(`library_item.deleted`, D-091).

**D-064 — Reviewers are designated by the board; faith content has its own review before it
reaches the whole board (Assumption).** `library_reviewers (board, user, approves_content,
reviews_faith)`, set by the operator with `pnpm admin set-library-reviewer` (and listed with
`list-library-reviewers`); the database refuses anyone who is not active staff of the board
(parents included) and audits every change. A board admin is not a reviewer unless designated.
Faith review applies (`requires_faith_review`, computed by the items trigger) to a
« Réflexion catholique », to an item whose author ticked « Contient du contenu de foi » (suggested
by a list of faith words), to an item with a faith link (text or Catholic reference) and to any
Enseignement religieux item. A reviewer can flag faith content the author did not tick
(`library_flag_faith`); the author cannot clear that flag, and an item already shared with the
whole board goes back to its school (or private) until its faith review. The same happens when
its author edits an item shared with the whole board that needs a faith review, since any edit
ends the earlier faith review (D-063; audited as `library_item.scope_reduced`). The faith review is
required for board approval and for sharing with the whole board; sharing with the school and
using it in one's own class stay under the teacher's authority (SPEC §9.5). Nobody approves their
own item; the board's own items have no author and are kept by its content reviewers, the audit
showing who did what. _Why:_ SPEC §9.3 (« someone the board designates »); the richer board
workflow of §12 comes later.
_Amended in Phase 6 (2026-10-02):_ board admins designate the board's reviewers in « Approbation des
ressources » (`set_library_reviewer`, naming the person by one of their roles in the board), and a
person's last role removed in a board removes their designation there (D-107). The CLI command stays
for the operator.

**D-065 — Who can see library items (amends D-013).** Three rules, each with a form that takes
the user (service role only) and a form for the current user:

- _usable_ (`app.library_item_usable_by`; browsing, search, printing, planning, substitute
  plans): the author (while active), or a reviewed or approved item shared with a school or a
  board where the user holds any role but parent;
- _readable_ (`app.library_item_readable_by`; row level security on items, versions, keys and
  links): usable, or a content reviewer of the board for requested, shared or approved items and
  the board's own items, or a faith reviewer of the board for requested items that need a faith
  review;
- _editable_ (`app.library_item_editable_by`): the author while she holds a role other than
  parent in the item's board (`app.library_board_staff`), or a content reviewer for the board's
  own items, while the item is a draft, reviewed or sent back.

| Item                                 | Author        | Staff of its school | Other staff of the board | Content reviewer              | Faith reviewer                 |
| ------------------------------------ | ------------- | ------------------- | ------------------------ | ----------------------------- | ------------------------------ |
| private (draft, reviewed, sent back) | read, edit    | —                   | —                        | if requested, or a board item | if requested and faith-flagged |
| reviewed, shared with the school     | read, edit    | read, use           | —                        | read, withdraw                | if requested and faith-flagged |
| reviewed, shared with the board      | read, edit    | read, use           | read, use                | read, withdraw                | if requested and faith-flagged |
| approved                             | read          | read, use           | read, use                | read, withdraw                | —                              |
| archived                             | read, restore | —                   | —                        | board items only              | —                              |

Board admins get no special library access and no longer read teachers' private drafts, which can
hold students' names restored after AI (D-013: no student data). Office staff can read shared
items through the API, as school staff, but have no library screens (D-078). Search and planning
use « usable » only, so items waiting for review never appear in a reviewer's own browsing and
cannot be put into a lesson or a plan (a lesson, class session or parent item may only point at a
usable item). _Why:_ reviewers see what they are asked to review and nothing else. _Amended in
Phase 5:_ the board's own items are those marked `board_owned` (the seed's board items, bulk
drafts and pack imports), which its content reviewers read, edit and keep at any status;
approving one makes it board-shared, and until then it is private; an item whose author was
deleted is not the board's and stays unreadable (D-091).

**D-066 — Sharing: reviewed items only, a first-name guard with a confirmation per name, board
levels only (Assumption).** Only reviewed items are shared. Before sharing, proposing to the board
or saving an item that is already shared, the web server runs the first names of the students of
the teacher's schools through the AI privacy tools (`Redactor`, students only, and
`findBlockedDetails`) over every string of the item and its keys. A student's first name is
listed, and the teacher may confirm each one as « Ce n'est pas un nom d'élève » (a saint, a
historical figure); only the count is audited (`names_confirmed`). E-mail addresses, phone numbers
and other blocked details always block. The guard catches accidents only; the database cannot run
it; staff names are allowed. Versions for a teacher's personal levels keep an item private and
cannot be proposed (`LXL10`), since colleagues cannot read those levels.

**D-067 — Required metadata and readiness (Assumption on the exemptions).** To be marked reviewed
an item needs at least one grade, a subject, a duration, materials (« Aucun matériel
particulier » is offered), a tag or a keyword (tags are a curated list, from content packs and
the operator; teachers add free keywords), a base version that passes `final`, at least one
attente (except pauses actives, réflexions catholiques, amorces culturelles and chansons), a
complete key for types with questions, and, for experiments and STEM challenges, structured
safety notes `{ageSuitability, allergyAwareMaterials, supervision: standard|close|adult_only,
hazards, notes}` (`LXL02`; the database refuses such an item outside draft, sent back or archived
without them). For board approval, reading passages, worksheets, exit tickets and quizzes also
need a version for every active board level; other types with levels show « Version de base
seulement ». A short answer without a sample answer is only a warning. Originality is confirmed
with a checkbox when marking reviewed, and audited. The database checks grades, subject,
duration, materials, tags, base version, attentes, the key's presence, levels and safety
(`app.library_assert_ready`, `LXL01` with the missing part in `detail`); the content schema and
the key's completeness are checked by the app (`reviewReadiness`), since SQL cannot run Zod, and
the renderer copes with content that fails them. A reviewed item must stay ready when saved
(« Remettez-la en brouillon pour l'enregistrer incomplète »). No images in Phase 4: « appuis
visuels » are text suggestions.
_Amended by « Commentaires de bulletin » (2026-10-02):_ a type that is not teaching material (the comment bank,
D-129) needs no duration or materials and no attente; it needs a subject unless its base version's
`scope` is `learning_skills`, and the app checks that the subject fits the scope (`scope`: none
for learning skills, Enseignement religieux for religion, another subject otherwise). An entry that
uses another level's qualifier is only a warning (`qualifier`, D-131).

**D-068 — Search: Postgres full-text search with a French configuration without accents, in one
function with the visibility rule written in.** `app.french_unaccent` copies `french` and removes
accents before stemming (the stemmer alone turns « idée » and « idee » into different words).
`library_items.search_document` is rebuilt by `app.library_refresh_search`, which every writer
calls: A the title; B the summary, keywords, tag labels and French names of the type (« billet
de sortie »); C the attentes' codes (as written and split into words) and texts; D the materials
and the strings of the base version without machine keys (ids, kinds, enumerated values). Answer
keys are never indexed. A GIN index covers it. Digit groups written with a space, a no-break space
or a narrow no-break space (« 1 000 ») are one number in documents and queries, so « 1000 » finds
« 1 000 ». The query keeps letters and digits only (so « défi-STIM », quotes and operators split
into words), except a curriculum code typed as written (« B1.2 »), which matches that code only
(never « B1.1 » or « B1.20 »); it requires up to 8 words and matches the last one as a prefix
unless it is a code. `public.search_library` is one definer function that computes the usable
set once, pinned to `app.library_item_usable_by` by a test, and returns the items and facet
counts, each facet ignoring its own filter. Order: approved first, then rank, then the title in
French order (`fr-CA-x-icu`), then id. Items waiting for review never appear in search.

**D-069 — Browsing follows the curriculum tables; anything unverified says « À vérifier »
(D-030).** Grade → subjects (standard or the board's own, by grade range, Anglais from the board's
`anglaisStartGrade`) → domaines → attentes (overall, then specific). Maternelle and Jardin use
`pmje`; there is no kindergarten content in the pilot (D-008), and an empty state says so. An
attente filter matches items linked to the attente, to its specific attentes (for an overall one)
or to its overall attente (for a specific one); counts follow the same rule.

**D-070 — Curriculum import tool, JSON only, with a licensing gate (amends D-030).**
`pnpm admin import-curriculum --file x.json [--apply] [--confirm-licence]` validates the file
(`curriculumFileSchema`) and is a dry run by default. It upserts strands by subject, version and
code, then overall and specific attentes by subject, grade, version and code (parents by code),
then rebuilds every search document (`library_refresh_search_all`, service role only). A file that
says `"official": true` or `"verified": true` is refused without `--confirm-licence`, which prints
the licensing warning.

**D-071 — The demo library is a versioned content pack of 29 original items (fulfils D-031;
Assumption on authorship).** `content/library/demo` (`pack.json` and one file per item) is
written for this purpose in Canadian French, validated in `final` mode, with fictional
characters and never a seed student's name. `pnpm library:seed` generates
`supabase/seeds/20_library_demo.sql`, one block that finds every reference by code and stops on
anything missing; CI fails on drift. The items belong to the content pack « Ressources de
démonstration (à valider en classe) » (`2026.1`); most are the board's own, approved by the demo
board's reviewer (faith items faith-reviewed by her), and a few belong to two teachers to show
the workflow. Ids are UUIDv5 of `demo/<slug>` under a fixed namespace. The reading passages,
worksheets, exit tickets and the quiz have the four board levels. The seed curriculum gains four
5e Français attentes with the same meaning as the 3e ones (C1, C1.2, D1, D1.1, unverified); no
other code is invented. A short list of global tags is seeded. Who owns what teachers share is
still open (licence left empty). _Amended in the library expansion:_ the pack has 78 items (49
more, for 3e and 5e in Français, Mathématiques and Sciences et technologie, plus a few Relier and
Jouer items), and items may link to attentes of the curriculum sample in `content/curriculum`
(3e and 5e, the same three subjects, 265 paraphrased attentes in the import format of D-070,
`"official": false` and `"verified": false`, uncertain codes listed under « À vérifier » in its
README). `pnpm library:seed` also turns that folder into `supabase/seeds/10_curriculum_demo.sql`,
loaded before the pack (seeds load in name order) and checked for drift in CI; it refuses
official or verified files. It keeps the rows `seed.sql` already has (ids, wording, strand,
parent) and only gives them the files' sort order, and the files keep every seeded code with its
wording (tested). A real board gets curriculum files only through the import command, after the
« À vérifier » review.
_Amended by « Commentaires de bulletin » (2026-10-02):_ 81 items: three comment banks (D-129), the board's own
and approved by its reviewer (**Assumption**: written by us, « à valider en classe »):
`commentaires-mat-3e-bulletin` (bulletin scolaire, B1.1, B1.2, B1.3, B2.3, B2.5, by level),
`commentaires-fra-3e-progres` (bulletin de progrès, C1.1 to C1.3 and D1.1, by progress mark) and
`commentaires-habiletes` (the six learning skills by rating, 3e and 5e, no subject), and a global
tag « Bulletin ».

**D-072 — On-demand generation: the database builds the request, and the result is a private
draft (amends D-038).** The AI feature `library_item` is requested with
`public.request_library_item(school, request)`; the request holds ids and choices only. The
database checks the role, the Library module, each id and its scope, builds the input with French
labels read from its tables (grades, subject, domaine, attente codes and texts, levels, the
Catholic reference) and queues it (`app.enqueue_ai_job`); `library_item_ai_preview` returns the
same input without queueing, so the preview is exactly what is sent. The output schema is chosen
per type. When the worker records a success, a trigger turns the result into a private draft of
the requester, with its provenance (prompt version, model, usage row, `ai_generated`), and writes
the item's id into the job's result; an unusable result fails the job (`invalidOutput`). Library
content is reusable, so the output may contain no person marker (« Élève A »): characters take
names from a fictional list sent in the request, less any name of a person the teacher can see
(so the list never trips the privacy check). Never automatic, always previewed; the generic
`request_ai_job` stays limited to « Texte différencié ».
_Amended by « Commentaires de bulletin » (2026-10-02):_ comment banks have their own feature,
`report_comment_bank`, requested the same way (`public.request_report_comment_bank`, previewed by
`report_comment_bank_ai_preview`, the input built by the database from ids) and turned into the
requester's private draft by the same `app.library_item_from_ai_result` (D-132); `library_item`
writes the 25 other types (`LIBRARY_ITEM_AI_TYPES`).

**D-073 — Versions per language level, and Phase 2 saved texts (amends D-042).** The AI feature
`library_levels` writes 1 to 6 missing level versions from an item's base version, with the same
objective and, for assessments, the same questions and kinds. The request stores the item's
revision; a result that arrives after the item changed fails the job (`libraryChanged`); asking
for a level the item already has gives `LXL09`, an input too large `LXL08`. What the AI writes is
a draft its author reads (SPEC §9.3): a reviewed item that gains versions becomes a private draft
again, its request cancelled (audited as `returned_to_draft`, reason `ai_levels`), and its
author marks it reviewed and shares it again, which runs the first-name guard and the faith
review again; the dialog says so before anything is sent. Texts saved from
« Texte différencié » are ordinary library items: the page sends canonical reading passages or
worksheets (`fromDifferentiation`) with short-answer keys, `save_ai_job_to_library` (for
« Texte différencié » results only) writes the keys, the schema version and the search document,
and texts saved in Phase 2 (`differentiated_text/v1`) are converted once by the library migration
(nothing is hosted, so there is no read-time upgrade). `/differentiate/saved/[id]` opens the
library item. Phase 2's limits stay: text up to 40,000 characters, empty glossary definitions,
objective up to 1,000, and a worksheet may have no questions when it has instructions or text.

**D-074 — Catholic connection toggle (amends D-058: the ranking is shared).** When generating,
« Ajouter un lien avec la foi » is off by default and forced on for a « Réflexion catholique ».
The suggestion comes from `rankCatholicReferences`, next to Phase 3's `pickCatholicReference`
(which becomes its first result): grade range, liturgical season, overlap with the attente,
subject and note, then the board's own, rotating by date; the teacher can pick another. The AI
writes one or two sentences tied to that reference only (a biblical reference, never a
quotation). The link is stored as `catholic_connection` and `catholic_reference_id`, always
editable, shown on the teacher copy and, with « Afficher le lien sur la feuille de l'élève », on
the student sheet. Setting it makes a faith review necessary before the item reaches the whole
board (D-064).

**D-075 — One document model for the screen, printing and PDFs; content stays in its own
language.** `RenderedDoc` blocks (heading, paragraph, list, steps, glossary, question, table,
lines, callout, rubric, answer, poem and `section {lang}`) are built by `renderStudentDoc`,
`renderTeacherDoc` and `renderAnswerKeyDoc` and drawn by `DocView` (HTML, also for printing) and by
the PDF renderer; PDFs are rendered on demand, never stored (D-053). The student sheet and the
teacher copy (« Guide et corrigé ») are separate documents. Printouts put one version per page
with a small number and never a level name (D-042). A student sheet with questions or writing
lines starts with « Nom : ____ Date : ____ », so collected sheets can be told apart. Content
carries `lang="fr-CA"`; the English half of a family guide carries `lang="en-CA"` (D-033).

**D-076 — Planning: attach a resource to a lesson, or add it as a new lesson (Assumption on the
defaults).** Material types are attached to an existing lesson (`unit_lessons.library_item_id`,
checked by row level security and the lessons trigger): nothing is copied and the lessons keep
their order. A lesson plan or a project can become a new lesson (`add_library_item_to_unit`), at
the end of the unit by default; the lesson copies the title, objective, materials, duration, a
plain-text outline and the attentes, keeps the link, and does not follow later changes to the
item. Only usable items can be linked. `usage_count` is the number of distinct units whose
lessons link the item (« Utilisée dans 3 unités »), recounted by a trigger so adding and removing
a link never inflates it; substitute plans and printouts are not counted. _Why:_ a worksheet is
material for a lesson, not a lesson of its own, and inserting lessons shifts « Aujourd'hui » and
substitute plans (D-010).
_Amended by « Commentaires de bulletin » (2026-10-02):_ a comment bank is not teaching material: a lesson never
links one (`LXK01`, the lessons trigger, so `add_library_item_to_unit` too), and « Ajouter à ma
planification » and « Joindre à cette leçon » are not offered for it.

**D-077 — Substitute plans use library items (amends D-048 and D-052).** A separate loader,
`app.sub_plan_library_sources(teacher, school)` (the teacher calls
`get_sub_plan_library_sources`), gives candidates for the open lessons; the web server and the
worker merge it into the Phase 3 sources, whose functions do not change. The candidates are the
lesson's own linked item when it is reviewed or approved, sub-friendly and usable by the teacher,
then approved, sub-friendly items of the board and subject that share a grade with the class and
an attente with the lesson. Assessments, rubrics, guides, projects and family guides are never
sub-friendly (a constraint); experiments and STEM challenges only under standard supervision.
Ties: a student sheet, then attente overlap, then fitting the block (at most 10 minutes over),
then the closest duration, then usage, then id; each item is used once per absence, and an item
that a lesson of the absence links itself is kept for that lesson (an earlier lesson that shares
its attente takes its next candidate). The plan
stores a snapshot in the block: the teacher document (no key) and one student document per set
of groups (the version of the group's level, else the base version); these fields are optional
and old plans still parse. The owner can hide the resource. A plan's JSON over 200 KB loses
snapshots from its last blocks first (`library_trimmed`). Sending an item back, withdrawing,
archiving, returning it to draft, sharing it more narrowly or editing a reviewed item marks the
upcoming absences whose plans name it or whose lessons link it out of date, as does any change to
a lesson's attentes; a new approval does not (Assumption): the next rebuild picks it up. The
loader returns no candidates for a school without the Library module (D-078), so the web server
and the worker build the same plan; it also returns the attentes in common and the usage, and the
builder ranks again against the minutes the substitute actually teaches (a shortened or
interrupted period). `hasAnswerKey` is true only when a key holds an answer or a solution. A
resource's step (« Distribuez « … » : voir « Matériel pour les élèves ». ») goes just before the
lesson's main step. Hiding a resource takes its step out (from the teacher's own edited steps and
the AI's steps too) and brings back `thin_lesson` for a thin lesson, so « Consignes détaillées
(IA) » asks for an activity again; « Utiliser cette ressource » and « Revenir au plan préparé »
bring the resource back, with its step put back before her main step when she wrote her own.
Its student pages are printed per group as the library prints them (D-075), without the blanking
of names and level words applied to AI activities. Known limits: the sources fingerprint does not
cover resources (one changed between reading and publishing shows at the next rebuild), and days
that can no longer change do not count for « once per absence ».
_Amended by « Commentaires de bulletin » (2026-10-02):_ comment banks are never sub-friendly (the constraint).

**D-078 — Licensing, roles and navigation (Assumption).** Library pages, navigation and actions
need a school with the Library module where the user is a teacher, principal or vice-principal,
or a reviewer designation. `request_library_item` and `request_library_levels` also check the
module in the database, because they spend money; everything else is checked in the app
(D-026). Office staff have no library screens. A teacher whose school has AI but not the Library
module keeps « Différencier »: her saved texts open, print, download and delete on their item
page (from « Mes textes différenciés »), with nothing else of the library (no editor, workflow or
planning). « Ressources » replaces « Différencier » as a
top-level item when it is shown: the hub links to « Texte différencié », and « Ressources » stays
highlighted on `/differentiate/*`. The phone's bottom bar keeps Phase 3's limit of six places
(`PHONE_BAR_MAX`); with more items, it shows the first five and « Plus », a sheet with the rest.
_Amended in Phase 6 (2026-10-02):_ « Direction » and « Conseil » join the navigation, in the order
of D-118, with each role's landing page (`landingFor`); the phone bar keeps this decision's six
places and « Plus ».

**D-079 — Library events and audit.** Events carry `{itemId}` (and `scope` for sharing) and
nothing else: `library_item.review_requested`, `.approved` (SPEC §7), `.rejected`, `.retracted`,
`.shared` and `.archived`; generation reuses `ai.job_requested`. Audit entries: for the workflow
`library_item.reviewed` (originality confirmed, revision), `.returned_to_draft`, `.shared`
(scope, names confirmed), `.review_requested`, `.review_cancelled`, `.approved` (type, revision,
whether faith review applied), `.rejected`, `.faith_approved`, `.faith_rejected`,
`.faith_flagged`, `.scope_reduced` (scope, reason: an edit that needs a faith review took it off
the whole board), `.retracted`, `.archived` and `.restored` (`.returned_to_draft` also gives a
reason when AI versions caused it); for AI `.generated` (job, author) and
`.levels_generated` (job, count); for designations `library_reviewer.designated`, `.changed` and
`.removed` (both flags). Notes, titles and names are never audited. _Amended in Phase 5:_
`library_item.remixed {parent_item_id}`, `.generated {bulk_run_id}`, `.approved {…, via}`
(`board_draft`, `content_pack`), `.deleted` for the board's items (status, type, pack key, bulk
run, usage and whether it was ever approved), and the bulk run and content pack entries of D-101;
opinions are never audited.

**D-080 — AI output quality without paid retries for form (amends D-041).** A feature may choose
its output schema from its input, normalize the answer before it is validated, and keep only the
common part of its prompt plus the section for the requested type. Normalizing converts the `ai`
shape to canonical content and fixes typography in French strings only (`'` between letters
becomes `’`, spaces inside « », a non-breaking space before `:`, « 3ème » becomes « 3e »,
« 1ère » « 1re »), scrambles ordering questions left in answer order and sets `faithContent` when
faith words appear. Substantive problems are still retried: missing keys, the wrong set of
levels, a level name shown to students, person markers, `NOT_CANADIAN` words, « CP/CE/CM »,
invented dotted attente codes, quotations over 40 words and third-party sources.
_Amended by « Commentaires de bulletin » (2026-10-02):_ the comment bank feature (D-132) chooses
its prompt sections by scope and report (`scope:subject`, `period:term`…) rather than by type, and
normalizes for free the placeholder's spellings (`{prenom}`, `[Prénom]` → `{prénom}`, « d’{prénom} »
→ « de {prénom} »), French names of kinds, skills, ratings, marks and categories, a feminine or
masculine text that repeats the neutral one, and each entry's attente key into its code; a marker,
another placeholder, a code in a text, another level's qualifier, a missing point fort or
prochaine étape and a text over the chosen length are retried.

**D-081 — Hooks for Phase 5 only.** `questions` on games (quiz battles), `studentContent`,
`gradeAll`, the content pack provenance and seed pack format (future export and import), and
`usage_count` with `library_expectation_counts` (the future coverage report). Class mode, trying a
resource as the students, remix, ratings, bulk generation, the coverage page, pack export and
import, images and math drawings, e-mail notifications, a board admin screen for reviewers and
tags, kindergarten content, keys in substitute plans and CSV import are not in Phase 4;
`ai_generations.batch_id` stays unused. _Amended in Phase 5:_ the hooks are used: games'
`questions` and `studentContent` feed « Présenter » and the quizzes on devices (D-082), the pack
provenance and seed format became content pack format v1 (D-099, D-100), `usage_count` shows on
every card (D-093), `parent_item_id` holds an adaptation's original (D-092), and
`ai_generations.batch_id` the bulk runs' batches (D-095). `gradeAll` stays unused (class mode
grades in the database, D-087), and « Essayer comme les élèves » is not built.

## Library growth and class mode (Phase 5)

**D-082 — Class mode has two players: « Présenter », which needs no session, and « Quiz sur les
appareils », which uses one; class mode never uses AI.** « Présenter à la classe »
(`/projector/items/[id]?v=…&s=…`) is a full-screen projector page built from a version the teacher
can read; it writes nothing. `presentSlides` (`@lynx/content`) builds the slides from the student
content only: every presentation opens with a title slide and closes with an end slide; `quiz`,
`exit_ticket` and `game` show one question per slide (a game shows « Déroulement » and « Pour
gagner » first), `brain_break` and `experiment` one step per slide, and any other item marked
projectable (a morning prayer, a song, a riddle) its student document in large type, one section per
slide. Types that need safety notes (experiments and STEM challenges) start with a « Sécurité »
slide made only of the reminders written for students, or a generic reminder, never the item's
teacher-facing `safety_notes` (they can mention a child's allergy). A question's answer and
explanation are fetched only when the teacher presses « Afficher la réponse ». « Quiz sur les
appareils » plays `quiz`, and `game` with at least one valid question, in the five question kinds
(multiple choice, true or false, matching, ordering, short answer). `unit_test` and `diagnostic` are
individual and on paper; `exit_ticket` is presented but not played on devices (Assumption: its
purpose is to see who needs help tomorrow, which anonymous play cannot show). No class-mode code
imports `@lynx/ai`, and the portal role can execute no AI function (students never use AI, D-039).
_Why:_ most classrooms will project without devices, and a presentation that holds nobody's data
should leave nothing in the database; prayers, songs and riddles are projected every day. Deviation
from SPEC §9.3 (« Class mode »): exit tickets are presented, not played on devices. As built
(slice S2): « Présenter » is offered to library users (teachers and direction at a school with the
Library module) for items they can use in class, the rule of « Ajouter à ma planification » (their
own items that are not archived, and reviewed or approved items shared with them), not every item
they can read: a reviewer reading a colleague's item that waits for review does not project it. The
page's loader reads only what the slides need (never the key table, the safety notes or a level's
name), and « Afficher la réponse » answers only questions shown on a question slide. The labels
projected on the slides (« Étape 2 sur 6 », « Sécurité », « Vrai »…) are in the content's language
(D-090), like the content; the player's controls stay in the interface language. The button opens
the projector as a new page load, not an in-app navigation, so the projector's tab never holds the
item page's data (its « Guide et corrigé », the teacher's note, the safety notes).
_Amended by « Commentaires de bulletin » (2026-10-02):_ a comment bank is a teacher document: never presented,
projectable or interactive (a constraint), and never played on devices.

**D-083 — Student devices reach the database only through a private schema run by a dedicated role
(amends D-012; the pattern of D-049).** The functions live in schema `class_portal`, which PostgREST
does not expose, and are executed by the role `lynx_class_portal`: the migration creates it
`NOLOGIN` (the operator gives it `LOGIN` and a secret password; the seed sets a local-only one), it
is never granted to `authenticator`, holds no table privilege and executes the five portal functions
(`join`, `state`, `set_team`, `answer`, `leave`) and nothing in `public` or `app`. The web server
connects with `CLASS_PORTAL_DATABASE_URL`: a `pg` pool of at most 5 connections with
`statement_timeout` 3 s and a 2 s connection timeout set by the client, so they also hold under the
CI fallback (`postgres` with `-c role=lynx_class_portal`), where role settings do not apply. Device
calls are route handlers under `/jouer/api/*` (not server actions), easy to scan, load-test and
protect. Each web process lets 5 calls run and 50 wait for the pool, and answers any further call
`503` with `Retry-After: 2`; an unknown device token is remembered as gone for 60 s (an LRU of
10,000 hashes), so a flood of random tokens never reaches the database. The role is kept apart from
`lynx_sub_portal` on purpose: that one reads alerts, and student devices must never share its path.
`anon` still executes nothing and `authenticated` cannot call the portal. Every call re-checks the
device token, the session's status and expiry, and closes an expired session itself; joining also
checks the school's Library module. Throttle keys are HMACs with their own key,
`CLASS_PORTAL_HMAC_KEY` (32 bytes, base64), so an install with the Library module but without the
substitute portal works. Without the URL or the key, quizzes on devices are off and « Présenter »
still works. _Why:_ functions executable by `anon` could be called by anyone holding the public key;
minting JWTs would put the JWT secret in the web server; the service role bypasses row level
security. One more role, password and pool: on hosted Supabase the pooler user is
`lynx_class_portal.<project-ref>`. As built (slice S3): the device API is `POST /jouer/api/join`,
`GET /jouer/api/state`, `POST /jouer/api/answer`, `/team` and `/leave`
(`apps/web/src/server/class-portal/`); the pool's limits are in `pool-options.ts`, which the
integration test opens with both logins (password, and `postgres` with `-c role=`); the negative
cache holds the SHA-256 of tokens (never a token) and answers `state`, `answer` and `team` alike;
a failed portal call is logged with its SQLSTATE only, never its message (it could quote what a
device sent). A unit test runs ESLint on the three guarded paths so the import guard (D-086,
guard 3) cannot be switched off unnoticed.

**D-084 — Joining: the class link first, a short code as a fallback, joining open only in the lobby
(Assumption on the numbers).** « Lien de la classe »: each class gets a random 32-byte token (43
base64url characters), created on first use and replaceable by the class team (« Remplacer le
lien », audited). It is stored in plain text in `class_mode_links`, a table no API role can read,
and the class team gets it through `public.class_mode_link()`, because the teacher must be able to
show it again. On its own it grants nothing: it lets a device into that class's lobby while joining
is open. The projector's QR code shows the same link; a device that opened it once and bookmarked it
joins by itself (`/jouer#k=…`: a fragment never reaches the server's logs). The code has 6
characters from a 22-character alphabet without look-alikes, `ACDEFHJKMNPRTUVWXY3479` (no 0/O/Q,
1/I/L, 2/Z, 5/S, 6/G or 8/B); it is unique among open sessions, shown in two groups (« K7M 4R9 »),
accepted with spaces, hyphens or in lowercase, and stored in clear in `class_sessions.join_code`;
any other character is refused by the web server without a database call. Joining is open only in
the lobby: it closes at « Commencer » or 20 minutes after the lobby opens, « Rouvrir les
inscriptions » reopens it for 20 minutes, and a session takes at most 60 devices. Joining returns a
random 32-byte device token, stored as its SHA-256 (`session_participants.token_hash`) and sent in
an HttpOnly cookie (`__Secure-lynx_jouer` over https, else `lynx_jouer`; `SameSite=Lax`,
`Path=/jouer`, the session's expiry). A second cookie, `lynx_jouer_device` (random, 30 days),
identifies the device for throttling, and the device API refuses a POST whose `Origin` is not
`APP_BASE_URL`. Throttling follows D-051: only failures are stored (`class_join_failures`, as HMAC
keys, never a raw address; IPv6 grouped by /64). Per device, after 10 failures in 15 minutes, wait
15 s × 2ⁿ (at most 5 minutes); per network, for typed codes only, after 100 failures in 15 minutes,
wait 2 s × 2ⁿ, at most 10 s (a board often sends every school through a few addresses, so the
network bucket can be the whole board, and one child with private windows must never stall it).
Nothing is recorded while waiting; an unknown class link counts against the device only; a valid
link with no lobby open answers « waiting », which is not a failure. A guessed code shows only the
quiz, and the teacher sees every device and can remove it (« Retirer »). Since the quiz can be the
teacher's own private draft, starting a session checks its device-visible text for the class's first
names (`findPersonalInfo`) and warns (« Lancer quand même »). Deviation from SPEC §6 and §9.3 (« a
team name or nickname »): devices get generated numbers and fixed team names (D-088). _Why:_ 22⁶ ≈
1.1·10⁸ codes open a few minutes at a time: about 760 guesses an hour per network give about
1.4·10⁻⁴ chance per hour of reaching one of 20 open lobbies, for an extra device the teacher sees;
class devices use the unguessable link. As built (slice S1): a device that joins the same session
again (same device key, for example after « Quitter ») gets its number, team and answers back
instead of a new number, so re-joining cannot fill the session; joining an expired session closes
it and answers « locked » (code) or « waiting » (link). As built (slice S3): the class link's
fragment stays in the address until the device joins, so the teacher can bookmark the page on each
device, as the « Lien de la classe » card says (a `#code=` fragment is removed at once); a device on
the class link tries again every 5 s while no lobby is open or joining is closed, so « Rouvrir les
inscriptions » lets it in; a code or link of the wrong shape is refused by the web server and
records no failure. Over https both device cookies take the `__Secure-` prefix, as the substitute
portal's. Starting a session checks the title, prompts, hints and options devices will show against
the class's students (`findPersonalInfo`).

**D-085 — Live updates by short polling, not Server-Sent Events or Realtime.** Devices call `GET
/jouer/api/state?v=<stateVersion>` every 1.5 s ± 250 ms while the page is visible, and back off to 5
s after errors; the answer is `{"status":"unchanged"}` unless the phase changed. `last_seen_at` is
touched at most every 10 s, and « connecté » means seen within 20 s. The projector polls `GET
/projector/sessions/[id]/state` every second. The transport is isolated in `useClassState` and
`useProjectorState`, so it can move to Server-Sent Events without SQL changes. _Why:_ Realtime is
not in CI and needs `anon` (D-012); school filtering proxies often buffer or cut long-lived streams;
polling is stateless and easy to test; scoring ignores speed (D-087), so 1–2 s of latency is fair to
everyone. About 20 small requests a second per class. As built (slice S1): only the teacher's
actions change `state_version` (and so wake the devices); a device joining, leaving, choosing its
team or answering does not, so a device can never make the projector's next action fail as stale
(LXC02). A device gets its own changes in the reply to its call. As built (slice S3): a busy answer
(503) waits what `Retry-After` says; the projector takes the state each action returns at once and
still polls every second for the answer count; an answer lost to the network is sent again with the
same payload while the question is on screen (the database answers `already`). One run of
`tools/load/class-mode-load.ts` (30 devices, 5 questions, against `next dev` in the shared
container) gave p50/p95 17/56 ms for the poll and 21/88 ms for answers, 22 requests a second, no
503; with 60 devices, p95 656 ms and no 503 (recorded, not a gate). Against the production build
(`next start`, same container): 30 devices and 5 questions, poll p50/p95/p99 7/13/84 ms, answers
9/13 ms, 23 requests a second; 60 devices and 3 questions, poll 5/12/221 ms, answers 7/11 ms, 43
requests a second; every device joined and answered, no 503, nothing left after the end.

**D-086 — Answer keys never reach devices; a device sees only its own result, only after the
question closes, and only when answers are shown (Assumption on the device feedback).** At start,
SQL builds `class_sessions.questions` from the version's content with a whitelist (`id`, `kind`,
`prompt`, `hint`, `multipleAnswers`, `choices`/`left`/`right`/`items` as `{id, text}`, and
`scorable`); it never reads `library_item_answer_keys` for that. The key entries (short answers
normalized) are copied into `class_session_keys`, which no API role and not the portal role can
read, and an answer is graded in SQL when it arrives. With « Montrer la bonne réponse après chaque
question » on (the default), a device learns only `{correct, points}` for its own answer, after
« Afficher la réponse »; with it off, nothing until the end, and the ranking only after the last
question. A device never shows the correct answer or the explanation. The projector (the teacher's
signed-in session) gets the current question's answer only in the reveal phase and only when answers
are shown; the full « corrigé » is never shown in class views. « Présenter » builds its slides on
the server and sends the player only the slides, never the item or its teacher-only fields, and
fetches one question's answer when asked. Five guards: pgTAP records every portal output over whole
sessions with sentinels planted in every key field; the portal role cannot select any table; ESLint
forbids portal code from importing library queries, Supabase clients and `@lynx/ai`; the web
server's Zod parsers strip unknown keys; Playwright scans every `/jouer/api/*` body for sentinels
and key names, and the HTML and RSC payloads for the sentinel values. _Why:_ SPEC §9.3 and §11
(« answer keys never reaching student devices »). As built (Phase 5 hardening,
`20261101090500_phase5_review_fixes.sql`): the snapshot names each option by its list and its
place on screen only (choices `a`, `b`, `c`…, matching columns `l1`…, `r1`…, ordering items `i1`…)
and the session's key is written with those ids. The content's own ids could carry the answer: the
Phase 4 editor and the AI path number ordering items and matching pairs in the answer's order and
scramble only their positions, so sorting the ids gave the order and `l1` paired with `r1`. With
answers hidden, the projector gets neither the answer nor how many answered right: beside the
per-choice counts, that number named the right choice (SQL, `liveStateSchema` and the screen each
drop it).

**D-087 — Scoring: accuracy only; a team's score is the sum of its per-question averages
(Assumption).** A question is worth 100 points. Matching earns round(100 × correct pairs ÷ pairs);
everything else is all or nothing. Short answers are not scored by default (young, ALF and PANA
students would lose on spelling); with « Noter les réponses courtes (orthographe exacte) », a short
answer counts only when its normalized form equals a normalized accepted answer
(`app.normalize_answer` in SQL: case, accents, quotes and apostrophes, spaces in numbers, the
decimal comma; pinned by pgTAP vectors; class mode does not use Phase 4's TypeScript
`normalizeAnswer`). There is no speed bonus, and no timer by default (20, 30 or 60 s on request). A
team's score is the sum, over the scored questions played, of the team's average score among its
members who answered; a question nobody on the team answered counts 0, so team size, late joiners
and silent devices do not change it. A device that leaves keeps its answers until the session ends;
a device the teacher removes loses them. Empty teams show « — » and rank last; ties share a rank. In
« Chacun pour soi » the projector shows class figures only (« 74 % de bonnes réponses »), never
device numbers, and each device sees only its own total. _Why:_ fair to classes of mixed language
levels, and nobody is ranked in public. As built (slice S1): a question is scored only when its
key entry is complete and fits the question (a single-answer question with one right choice, every
left item of a matching paired once, an ordering that is a permutation of the items); otherwise its
answers are recorded and not scored. An answer with any other field, or an id the question does not
have, is refused as invalid. A team's `members` counts its devices, including one that left (its
answers still count); team scores are rounded to whole points.

**D-088 — Nothing a student types is stored (Assumption).** There are no free nicknames: devices are
numbered (« Tu es l'appareil 7 »), and teams come from a fixed list (« Les Huards », « Les
Castors », « Les Orignaux », « Les Ours », « Les Loups », « Les Renards »; keys `huards` to
`renards`, the same in `CLASS_TEAMS`, in SQL and in the messages). A short answer is graded in the
transaction that receives it and stored as `{}`: only its score and correctness are kept. Devices
keep typed text in component state only (nothing in `localStorage`), and inputs turn off
autocomplete, autocorrect, automatic capitals and spell check (Chrome's enhanced spell check sends
text to Google). _Why:_ Mike's privacy rule; there is nothing to moderate, and nothing to delete but
counts. Deviation from SPEC §6 and §9.3 (nicknames).

**D-089 — Responses are deleted when a session ends; only the class aggregates the teacher chooses
to keep survive (implements SPEC §6; amends D-018; Assumption on the interpretation).** Ending a
session (`end_class_session`), or its expiry 2 hours after the start, deletes in one transaction
every answer and device of the session, its keys and its question snapshot. If « Garder les
résultats de la classe (sans noms) » was ticked (it is off by default),
`class_session_results.aggregate` is written first: counts per question and choice, team scores and
totals, never device numbers, participant ids or anything typed. An expired session is closed by the
worker's sweep every 5 minutes (`class_mode_maintenance`) and by every portal call,
`class_session_live`, `class_mode_overview` and `start_class_session`, so an install whose worker is
down still deletes at the next class-mode call for that class. Each end is audited
(`class_session.ended`, counts only). Kept results last `classModeResultsRetentionDays` (a board
setting, default 365 days); closed sessions without results are deleted after 30 days and join
failures after a day. Deleted rows survive in database backups and point-in-time recovery for the
backup window, which `docs/phase-5.md` (and PRIVACY.md in Phase 6) says. As built (slice S1): the
projector's controls and « Garder les résultats » refuse an expired session with LXC05 without
closing it (an error would undo the deletion); the projector's next poll closes it a second later.
Only a closed session can be deleted through the API (« Supprimer » on kept results), so an open one
always ends through `end_class_session`, with its answers deleted and the end audited.

**D-090 — Who runs class mode, one version per session, French student screens (Assumption).** Class
mode is part of the Library module; the class tab « Mode classe » also needs Teaching, as every
class page does (pilot schools have both). Only the class team with a teacher role starts, controls,
ends or reads sessions and results (`app.my_class_ids()`, D-036); principals and office staff get
nothing new and never see a teacher's sessions or results (D-013). A session plays one version (the
base one by default; the others sit under « Autre version », so level names are not on screen by
default), so every team answers the same questions, and the projector never shows a level name.
Student screens are in French whatever the device's language cookie: the proxy marks `/jouer`
requests, and `i18n/request.ts` then serves `fr-CA` with only the `classPortal` messages, so no
staff catalogue reaches a device. Content follows its subject: Anglais (`ang`) is `en-CA`,
everything else `fr-CA`. For a noisy classroom and a washed-out projector: targets of at least 64 px
on devices, text of at least 22 px on devices and 40 px on the projector, colour always paired with
a shape and a letter (team colours `--color-team-blue`, `-orange`, `-green`, `-purple`, `-slate` and
`-red`), no sounds, and `prefers-reduced-motion` respected. The projector needs 768 px of width in
landscape; below, it says « Ouvrez cette page sur l'ordinateur branché au projecteur. » As built
(slice S3): the request header is `x-lynx-surface` (`jouer` or `app`, `apps/web/src/lib/surface.ts`);
the class tab shows for a class team member with a teacher role at a school with the Library
module; team names come from both `classMode.teams` and `classPortal.teams` (a unit test pins them
to `CLASS_TEAMS`), and answer choices take the team colours and shapes in order (choice A is the
blue circle on the projector and the devices). As built (Phase 5 hardening): classroom screens are
often 1366 × 768, 1280 × 720 or 4:3, so the lobby puts the teams in a row of tiles under
« Rejoignez la partie », sized by the screen's height as well as its width (six teams fit at
1920 × 1080, 1366 × 768, 1280 × 800, 1280 × 720 and 1024 × 768); a choice's « Bonne réponse » and
count follow its text or go under it, never squeezing it; a screen still too tall scrolls in its
own region, which the keyboard reaches, and « Afficher la réponse » brings the right choice and
the explanation into view; « 18 réponses sur 27 » sits beside « Question 3 sur 10 » in projector
type; the presenter's slide keeps clear of its countdown. Device text is at least 22 px
everywhere. Content keeps its language in accessible names too: a choice's button is named from
its parts (`aria-labelledby`), so « Réponse B : » stays French and the choice's text English in
an Anglais quiz, and so do the arrows' labels, the projector's hints and explanations, and the
kept results.

**D-091 — Board items: `board_owned` replaces « board_created with no author » (amends D-065).**
`library_items.board_owned` is set at creation for the seed's board items, bulk drafts and pack
imports, and a check forces `author_id` to be null. The board's content reviewers read, edit and
keep board items at any status, and may delete board drafts (draft, sent back or archived).
Approving a board-owned item makes it board-shared (`share_scope = 'board'`); before that it is
private. An item whose author was deleted does not become board-owned and stays unreadable, so
nobody reads a teacher's private drafts (D-065). `app.am_library_reviewer(board, kind)` (the current
user) is added for policies; `app.library_reviewer(p_user, …)` stays service-role only. As built
(slice S4, `20261101090100_library_growth.sql`): the flag never changes after creation (a trigger
refuses it, 22023); the seed's and tests' board items were marked by the migration; the item page's
« Ressource du conseil scolaire » and the reviewer's editing follow the flag, not the source (a
board's AI draft is `ai_generated` and the board's). As built (Phase 5 hardening): deleting a
board item is audited (`library_item.deleted`, with its status, type, pack key, bulk run, usage
and whether it was ever approved, which archiving hides) by a trigger, so the reviewer's
« Supprimer le brouillon », an operator's delete and any other path are covered; deletions that
cascade from a board or a school are not.

**D-092 — « Adapter » (remix): a private copy with lineage, credit and a sharing cap (uses the D-081
hook; amends D-063).** `public.remix_library_item` copies any item the user can use (their own, or
reviewed and shared with them, or approved) that is not archived (`LXM01`) and whose licence allows
derivatives (`no_derivatives`, else `LXM02`: « Cette ressource ne peut pas être adaptée
(licence). »). The copy is a private `teacher_created` draft of the user, with `parent_item_id` and
`parent_title` (the original's title at copy time); its id is chosen by the client once per dialog,
so a retry returns the same copy. Copied: grades, attentes, tags, keywords, materials, duration,
formats, safety notes, the faith fields (faith review still applies) and the licence, and each
version for the base, a board level or the user's own personal level, with its key. Not copied:
`sub_friendly` (reset), AI provenance, the pack link, who flagged faith content, opinions and usage.
Sharing cap: an adaptation of an item shared with one school may be shared at most with that school
(`LXM03`, from a trigger on every write path); a copy of a board-shared or approved item, or of
one's own item, has no cap, and a copy of a capped item keeps the cap. Credit, read live from
`public.library_item_lineage` and never stored in the copy (the direct parent only): « Adaptée de
« … » », then « par Mme Tremblay (É.É.C. Saint-Exemple) » when the viewer can use the original (the
school only for a school-scoped original), « (Conseil scolaire) » for board items, « (ensemble
« … ») » for pack items (Phase 4's word for content packs on the item page), or « (ressource
d'origine non disponible) ». The first-name guard (D-066) also reads `parent_title`. Approved items
stay read-only: to change one, even her own, a teacher adapts it. Audited as `library_item.remixed
{parent_item_id}`. As built (slice S4): an original from a content pack credits the pack even when
the board owns it (the demo resources credit « (ensemble « Ressources de démonstration (à valider
en classe) ») », as their « Détails » already name the pack), then board items « (Conseil
scolaire) », then the author; an original whose author was deleted names no one. The user must be
staff of the original's board (as for any new resource). The copy's school is the cap's, else the
original's when the user works there, else her only school in the board (none when she has several:
she picks one when sharing). A capped adaptation cannot be proposed to the board either (`LXM03`
from `library_request_approval`, since approval shares board-wide). « Adapter » is offered on the
item page for resources the user can use, her own only once approved (she edits the others); a
licence that forbids it shows « Cette ressource ne peut pas être adaptée (licence). » instead. The
editor of an adaptation shows its credit line too, « Partager » shows the credit colleagues will
see, and « Mes ressources » marks it « Adaptation ».

**D-093 — Opinions (« Votre avis »): anonymous stars on board-approved items, an average from 5
opinions, rounded to the half star (Assumption; deviation from SPEC §9.3).** A staff member who can
use a `board_approved` item and did not write it gives it 1 to 5 stars, with no text, through
`public.rate_library_item` only (`LXR01` on one's own item, `LXR02` on an item that is not
board-approved); board-owned items have no author, so anyone may rate them, principals included
(question 6). Teachers' school-shared items are not rated, to avoid peer judgement: SPEC §9.3 says
« anonymous ratings » without that limit. A rating is readable only by its rater and is never
audited; nobody, reviewers and direction included, sees who rated. Cards and the item page show « ★
4,5 sur 5 (7 avis) » from 5 opinions, and below that « 3 avis : pas encore assez pour une moyenne ».
Usage is Phase 4's `usage_count` (« Utilisée dans 12 unités », D-076); class-mode plays are not
counted. The label is « Votre avis », because « appréciation » evokes « appréciation du rendement »
in Ontario schools. As built (slice S4): `public.library_item_stats` gives the average, the count,
the user's own stars and the usage for up to 50 items she can use (one call per page of results);
direct writes to `library_item_ratings` are closed. The stars are a radio group saved on each
choice (the last one when the arrows move through several), with « Retirer mon avis »; with no
opinion yet the item page says « Aucun avis pour l'instant » (cards show nothing), and an author
sees « Avis des collègues » on her own approved resource, without stars. Every card shows its
usage, « Pas encore utilisée dans une unité » at 0. As built (Phase 5 hardening): the average
and count a person sees leave out her own opinion and count an opinion once it has been unchanged
for a day (the hint under the stars says so). Changing one's own stars and watching the rounded
average let anyone work out the others' exact stars from 5 opinions on; now her own changes show
her nothing, and two colleagues acting together learn at most one value a day (a residual risk
in `docs/phase-5.md`). Two colleagues can therefore see counts that differ by one.

**D-094 — Coverage counts board-approved items linked directly.** « Couverture du curriculum »
(`/library/coverage`, and `pnpm admin coverage` from the same database function) lists, for a grade
and subject, each attente with the number of the board's approved items linked to it; for an overall
attente, the items linked to it or to one of its specific attentes, each counted once. This differs
from browsing (D-069), which also matches the parent attente, so one overall-level item would look
like coverage of every specific attente; the page says so (« Comment on compte »). Items that are
only shared are not counted, so no other school's school-scoped item is revealed. « Aucune » is 0
approved; « Peu » is fewer than the threshold (default 2; 1 to 5). The board's content reviewers
also see « en révision » (requested items and non-archived board drafts). Everyone with the Library
module sees the page; the operator gets the same data from the CLI (the service role may call the
function). As built (slice S5, `20261101090200_library_coverage.sql`): `public.library_coverage` and
`public.library_coverage_summary` answer the board's staff (42501 otherwise, 22023 for a subject
that is neither standard nor the board's) and the operator, recognized by the database role
PostgREST switches to for the service key (not by the token's claim); the counting rule
(`app.library_coverage_rows`) stays internal (the definer functions call it, as can the bulk
planner's `--from-coverage`, D-097). The page is also open to the board's designated reviewers who
work at no school (as the hub, D-078), so a board admin who approves content sees « en révision ».
« Vue d'ensemble » is a table of grades and subjects (the subjects each grade offers, Anglais from
the board's start grade, active subjects only), each cell « 14 sur 22 » (attentes with at least one
approved resource) and how many have none; the list filters and the threshold (1 to 5) live in the
address. « Créer une ressource » (a library school) and « Créer avec l'IA pour cette attente » (AI
on) are offered for attentes below the threshold; « Voir les ressources approuvées » opens the
search for that attente, whose count can be higher (D-069). `pnpm admin coverage` without `--grade`
and `--subject` prints the summary; `--csv` writes RFC 4180 CSV.
_Amended for « Mon année » (2026-10-02):_ a class's « Couverture des attentes » (D-125) uses the
same counting unit and lists the curriculum the same way: `groupExpectationsByDomaine`
(`apps/web/src/server/curriculum-groups.ts`) groups the attentes by domaine for both pages, and
`isCoverageUnit` (`@lynx/domain`) decides what both count; the library's page is unchanged (its
unit tests were not touched). What is counted differs: here, the class's own teaching, never
resources.
_Amended by « Commentaires de bulletin » (2026-10-02):_ a comment bank (D-129) is never counted:
it is not a resource for teaching an attente, so it neither fills a gap nor keeps bulk generation
from planning one.

**D-095 — Bulk generation is an operator tool that writes board drafts through the Message Batches
API (Assumption on who runs it).** Only the operator launches it (`pnpm admin bulk-plan`,
`bulk-start`, `bulk-status`, `bulk-cancel`, `bulk-report`), for one board at a time and with at most
one active (planned or running) run per board. Board admins get no screen: they hold no library
role, and bulk spending is outside school budgets. Content reviewers see the drafts grouped by run
in « Brouillons du conseil », with « Approuver pour le conseil » in one step. It uses the same
feature `library_item`, prompt version, input schema, `normalize`, `validate` and `max_tokens`
(64,000, D-045) as on-demand generation (D-072), with inputs built in SQL from ids; there is no
teacher note: the note holds the operator's (at most 1,000 characters) and the titles of existing
board-visible items for that attente and type (« Ressources existantes à ne pas reprendre : … »).
Durations are the type's default; `subFriendly` comes from `--sub-friendly`. Refused:
`catholic_reflection` and the Enseignement religieux subject (faith content is generated one item at
a time), and a board that does not allow AI (`LXA01`, checked at planning, at start and before
submission). The results are board-owned drafts (`ai_generated`, `bulk_run_id`, provenance from
`ai_generations`) that reviewers review. Costs go to `ai_generations` with the batch id and the
board, `school_id` and `user_id` null; `pnpm admin ai-usage` shows them as « Génération en lot
(conseil) ». Each batch is deleted at the provider as soon as its results are read. Implements SPEC
§9.3 (« Bulk ») and §10. As built (slice S6, `20261101090300_library_bulk.sql`): `public.library_bulk_plan`,
`library_bulk_start` and `library_bulk_cancel` are the service role's only (the CLI); the worker's
steps are `app.library_bulk_mark_submitting`, `app.library_bulk_record_result` and
`app.library_bulk_finish`. Each request is for its attente's own grade (`--grade` chooses which
grades' attentes are targeted: one or two), and `--levels` defaults to `all`, since quizzes,
worksheets, exit tickets and reading passages need every board level before approval. A plan with
nothing to send is cancelled at once by the CLI. The CLI speaks English, like the rest of `pnpm
admin`; `ai-usage` shows bulk costs on a line « Génération en lot (conseil) / bulk generation
(board) ». « Approuver pour le conseil » is `public.library_approve_board_draft` (content reviewers,
the board's own items not yet proposed): it runs Phase 4's `library_mark_reviewed`,
`library_request_approval` and the decision (now `app.library_decide_as`, which `library_decide`
calls; the audit says `via: board_draft`), and stops with `faith_review` for faith content. The item
page shows it, with « Supprimer le brouillon », in the « Décision » panel of the board's drafts. The
worker also flags an answer that holds a first name of a student of the board (`student_name`, a
coincidence the reviewer checks before approving: characters take only names the request allowed);
it is never text, only a code.

**D-096 — A hard cost cap per run: one batch, sized to its worst case.** Each run has a required
`max_cost_usd` (at most 1,000, checked in SQL); the worker refuses a run above `BULK_MAX_RUN_USD`
(default 100) before submitting it (`overLimit`), and the CLI checks the same setting. The worst
case of a request is input tokens × the higher of the input and cache-write prices × 0.5, plus
`max_tokens` × the output price × 0.5. Input tokens come from `messages.countTokens` with the same
system, message and output format (free; plus 2 % and 50 tokens), or, if counting fails, from the
UTF-8 bytes of the system, the message and the JSON schema plus 2,000 (a token covers at least a
byte). `max_tokens` bounds the output, thinking included, so a run can never cost more than its
worst case as long as the price table is right. The worker takes requests in order while the running
sum of worst cases stays within the cap, and the rest become `skipped/cost_cap`. One batch per run
and no retries: running `bulk-plan` again plans only what is still missing. Real cost is about a
fifth of the worst case, so the CLI prints both (« pire cas » and « habituel »). _Why:_ SPEC §10 and
§9.3 (per-run caps): a cap guaranteed by `max_tokens` and the price table, not an estimate, without
a reservation engine. With Opus 5.5 batch prices a request's worst case is about $0.66, so a $25 cap
sends about 37 requests. As built (slice S6): `packages/ai/src/batch.ts` (`worstCaseUsd`, `countedInputTokens`,
`fallbackInputTokens`, `fitWithinCap`, exact to the micro-dollar); tokens are counted only until the
cap is reached (the rest are skipped anyway). `pnpm admin bulk-plan` prints an upper bound from the
bytes of each request (the fallback), priced with the worker's settings (`AI_PROVIDER`, `AI_MODEL`,
`AI_PRICE_*`, now also read by the CLI), and « usually » as 10 % to 30 % of the worst case that fits.
A batch is created with the SDK's retries off, so a lost answer never creates a second one.

**D-097 — Deduplication before and after generation.** At planning, an (attente, type) pair is
`skipped/covered` when the board already has at least `--per-expectation` items (default 1, at
most 3) of that type linked directly to that attente: board-approved items, board-shared reviewed
items and non-archived board drafts count; school-shared items do not. There is one active run per
board, so two runs never claim the same pair. The prompt receives the titles of the existing
board-visible items for that attente and type. After generation, a normalized title equal to that
of a non-archived board-visible item of the same type keeps the draft (it was paid for) and flags
it for the reviewer (« Titre semblable à une ressource existante »). Running the same `bulk-plan`
later retries only what is still missing, because created drafts count as covered. As built
(slice S6): the titles sent are those of the board's items of that type linked to the attente
(approved first, then the most recent), cut to keep the note within 1,000 characters; « titre
semblable » compares `app.library_norm_title` (lower case, no accents or punctuation) with the
board's non-archived own or board-wide items of the same type, drafts of the same run included.

**D-098 — The provider's batch extension shares the privacy checks (amends D-037 and D-041).**
`AiProvider` gains an optional `batch` (`countInputTokens`, `submit`, `status`, `results`, `cancel`,
`remove`): the Anthropic implementation uses `messages.batches.*` and `messages.countTokens`, and
the fake answers with each item's `fake()` and ends at once. `runFeature` is split into
`prepareCall` (validate, redact, block, `assertSafeOutbound`, choose the schema and `max_tokens`)
and `checkOutput` (normalize, validate, restore); the streamed and batch paths both use them, and a
test pins that they refuse the same inputs. Bulk inputs are redacted with everyone of the board
(`loadBoardPeople`: every student of its schools and every staff member with a role at the board or
its schools). So a fixed first name in a system prompt would eventually refuse every request of
every board: character names are chosen per request, less anyone the request knows (D-072), and a
test runs every `prompts/**/*.md` through the last check with the demo people. When results arrive,
the worker prepares each call again and compares the SHA-256 of what it would send with the stored
one; a mismatch (the people changed) fails that request (`redaction_changed`), so names are never
put back against different markers. Costs use the batch price (half). `ai_jobs_feature_check` and
`request_ai_job` are unchanged: bulk requests live in `library_bulk_requests`, not `ai_jobs`, so
school budgets and per-person limits do not apply (D-096 does). `library_bulk_requests.sent_text`
keeps exactly what was sent for 30 days, then only its SHA-256. As built (slice S6):
`prepareCall` and `checkOutput` are in `packages/ai/src/run.ts`; `sentSha256` hashes the system
prompt and the message; `sent_text` keeps the message (the system prompt is the versioned file).
`loadBoardPeople` is in `apps/worker/src/ai.ts`. The fake provider's batches end at once, so a
run completes in one tick in CI and demos; `pnpm ai:eval --feature library_item --batch --provider
fake` runs the ten cases as one batch through the same code. An answer whose request cannot be
prepared again (its input no longer valid) is also `redaction_changed`.

**D-099 — Content pack format v1 and export scope (Assumption on the scope; uses the D-081 hook).**
One UTF-8 JSON file (`@lynx/content` `pack-format.ts`): `{format: 'lynx-content-pack',
formatVersion: 1, pack: {slug, version, title, publisher, licence, noDerivatives, createdAt,
contentSchemaVersion: 1}, levels, tags, catholicReferences, items, checksum}`. Items point to the
subject code, grade codes, attentes as (curriculum version, grade, code), level codes, tag slugs
(the tags are listed once at the top) and Catholic references as (type, title); each has a stable
`key`, a `hash` (SHA-256 of its canonical JSON) and `provenance {source, promptVersion, model}`, and
its text fields are strings (empty rather than null). The version is `YYYY.N` with no leading zero
(`2026.10` comes after `2026.9`); the checksum is the SHA-256 of the sorted « key hash » lines, so
item order does not matter. A pack holds no user ids, names or school data. Exported by default:
board-approved, board-owned items that did not come from another publisher's pack;
`--include-pack-items` adds other packs' items (a licensing choice), and `--include-teacher-items`
adds approved items written by teachers, credited to the board only, with the licensing warning
(question 5). Versions for personal levels are never exported. Every string goes through the
first-name check (`findPersonalInfo`) with the board's students and staff: items with a hit are left
out and reported by key and word, and `--allow-names` lists words the operator confirms are not
people (Marie, Joseph, Pierre…). Pack files contain answer keys, so they are confidential and never
hosted publicly (`docs/content-packs.md`). Export and import are CLI-only: board-hosted installs
have no Storage or upload screen yet, so the board's IT receives the file (download, USB key or
e-mail) and runs the CLI. Implements SPEC §9.3 (« On-prem »). As built (slice S7,
`20261101090400_content_packs.sql`, `apps/admin/src/commands/packs.ts`): the database's
`public.content_pack_export_items` (service role only, pages of 100) gives items by code; the CLI
turns them into pack items (`packItemFromExport`, `assemblePack`), leaves out those the schema
refuses (reported with their paths) and writes the file readable by its owner only. An item's key
is its key in the pack when it is exported again under the same slug, otherwise its id, so two
packs' keys never collide in one export. « Another publisher's pack » is decided by `--publisher`:
items from the exporter's own packs (the demo board's seed pack for IP Lynx) are its own content.
The name check (`findPeople`) reads every prose string of the item, its content and its keys, with
the board's students and staff (staff names included, unlike the sharing check); a finding the
operator lists in `--allow-names` is not one. `--grade` and `--subject` take lists. Each export is
audited once written (`content_pack.exported`, with the file's SHA-256), as the operator's
(`service`). `pnpm library:pack` builds the demo folder as a pack whose hashes are those
`20_library_demo.sql` records (`tools/seed-pack-files.ts` gives both the curriculum versions and
reference types). The screens say « Ensemble » for a pack, as Phase 4's item page did.

**D-100 — Import is staged, previewed and applied in one transaction; it lands private in the
board's approval queue, and local edits win (Assumption).** The CLI stages the file in chunks of 50
items, then previews it (a real dry run, the default) or applies it with `--apply` in one
transaction; a staged import can be discarded and is deleted after a day. New items are board-owned,
`teacher_reviewed` (the provenance says the publisher reviewed them) and private with approval
requested, so only reviewers see them until they are approved; `sub_friendly` is forced off; faith
content is the pack's flag, or a faith word (`suggestsFaithContent`), or the Enseignement religieux
subject, or a « Réflexion catholique »; at most 30 new board tags are created per import (the rest
are dropped with a warning). Levels map by code, with `--level-map` for different codes (the
versions of an unmapped level are skipped with a warning); attentes need their exact curriculum
version; a Catholic reference matches (type, title) among the board's rows, then the global ones,
and none or several gives no link and a warning. `--approve --approver <email>` approves through the
same path as `library_decide` (the approver recorded, `library_item.approved` emitted, audited with
`{via: 'content_pack'}` and actor `service`), only when the approver is one of the board's content
reviewers (`LXP04`), and only ready items, never faith items, experiments, STEM challenges or
outdoor activities. Later versions: the same hash is `unchanged`; an item edited locally since its
import (`content_revision ≠ pack_revision`) is `skipped_modified_locally`; an untouched item not yet
approved is updated in place and stays in the queue; an untouched approved item is
`changed_not_applied` (reported, never replaced in v1); items missing from the new version are
reported as `not_in_pack`. Importing a version already applied gives `LXP01`, a lower one `LXP02`.
The item shows « Éditeur déclaré : IP Lynx · importé le … · empreinte 3fa4c1d2e9b0 » (the first 12
characters of the file's SHA-256). _Why:_ a checksum is not a signature and the publisher is
self-declared, so nothing imported reaches teachers until a named reviewer approves it; signed packs
come later. As built (slice S7): the dry run is the import itself in a subtransaction that is rolled
back (`content_pack_preview`), so its report is exact; the CLI discards the staged import after it.
A created or updated item that is ready for approval (`app.library_assert_ready`) waits in the queue;
one that is not (a level with no board level, an unknown attente…) stays a board draft, and the
report says what is missing. Such drafts are listed under « Autres brouillons du conseil » in the
reviewers' « Brouillons du conseil » tab (with the pack's badge), below the bulk runs' drafts
(integration of round R4); the tab dropped « (IA) » from its name for that reason. An item a reviewer withdrew or sent back and nobody edited is replaced
by the next version (it was not approved); archived items, approved items and the seed's teachers'
items are never replaced (`changed_not_applied`). A pack item naming a Catholic reference is faith
content too. The database recomputes the checksum over the staged items before applying (`LXP05`
when staging was cut short). Approval uses `app.content_pack_approve_item`, the same checks, update,
audit action and event as `library_decide`, audited as the operator's (`service`) with `via:
'content_pack'`, the approver and the pack. The review queue shows « Ensemble : <titre> <version> »
and « Détails » the declared publisher, the import date and the fingerprint (none for a seed pack).
`list-packs` prints each pack's report (counts and the keys changed but not applied). Staged imports
are deleted after a day by `content_pack_stage` and `app.content_pack_maintenance` (called by the
daily `library_maintenance`). As built (Phase 5 hardening): local deletions win too. Deleting an
item a pack wrote leaves its key in `content_pack_removed_items` (board, slug, key: no content, no
person), and later versions report it as `skipped_deleted_locally` (« deleted here, not
re-created ») instead of creating it again; the operator removes that row to get it back from the
next version (`docs/content-packs.md`).
_Amended by « Commentaires de bulletin » (2026-10-02):_ a learning-skills comment bank has no subject: the
export keeps it with `subjectCode` null, and the import accepts a null subject for such a bank
only (its base version's `scope`).

**D-101 — Events, audit and retention for Phase 5 (amends D-018 and D-079).** Events carry ids only:
`library_bulk_run.started {runId}` and `library_bulk_run.cancel_requested {runId}` (the worker's
`library_bulk_kick` handler runs the bulk tick at once), `library_bulk_run.completed {runId}`,
`content_pack.imported {packId}`, and `library_item.approved` through Phase 4's path. Class mode
emits none (30 devices would flood the outbox for no subscriber). Audit: `class_session.ended
{responses_deleted, participants_deleted, results_kept}`, `class_mode_link.replaced {class_id}`,
`library_item.remixed {parent_item_id}`, `library_item.generated {bulk_run_id}`,
`library_item.approved {…, via}`, `library_bulk_run.started {max_cost_usd, request_count}`,
`library_bulk_run.cancelled`, `library_bulk_run.completed {created, similar, skipped, failed,
spent_usd}`, `content_pack.exported {slug, version, item_count}` and `content_pack.imported {slug,
version, created, updated, unchanged, skipped}`; ratings are never audited. `class_session.ended`
rows show how often each teacher uses class mode, so the Phase 6 audit viewer must not give the
direction a per-teacher view of them (D-013). Worker tasks: `class_mode_maintenance` and
`library_bulk_tick` every 5 minutes, `library_maintenance` daily. Retention: class-mode answers and
devices until the session ends (at most 2 hours, plus 5 minutes if nobody calls); join failures a
day; closed sessions without results 30 days; kept aggregates `classModeResultsRetentionDays` (365
by default); bulk runs and requests a year (they hold no personal data), runs planned but never
started a day, `sent_text` 30 days (its SHA-256 stays); provider batches deleted once read
(otherwise at most 29 days at the provider); staged pack imports a day; opinions until the rater or
the item is deleted. As built (slice S6): bulk runs are also audited when planned
(`library_bulk_run.planned {max_cost_usd, request_count, covered}`) and when they fail
(`library_bulk_run.failed`, with the counts and `error_code`), as the operator (`service`) or the
worker (`system`); `library_bulk_run.completed` is emitted however a run ends. The daily
`app.library_maintenance()` also fails a run whose submission was never confirmed
(`submitUnconfirmed`) and calls the packs' own clean-up (`app.content_pack_maintenance`) when it
exists.

## Pilot readiness (Phase 6)

Built one slice at a time (S0 foundation; S1 accounts, onboarding, settings and feedback in the
database; S2 audit viewer, AI usage, retention and heartbeats; S3a web operations; S3b Docker,
backups and CI; S4 « Conseil »; S5 « Direction » and the audit log; S6 onboarding, legal, feedback
and release notes; S7 documents, demo and the security review). Each slice adds its « As built »
notes here.

**D-102 — The principal's view is a read-only dashboard of hand-off and contribution status, never
of teaching work (implements SPEC §9.6; amends D-013 and D-036).** « Tableau de bord de la
direction » (`/direction`) shows, per school the person directs (principal or vice-principal):
today's and the next school day's absences with plan, code, device and report status, from the
same rows as « Suppléances » (`loadSubBoard`, already allowed for the direction); the school's
library contributions (« 7 ressources partagées avec l'école · 3 avec tout le conseil · 2
approuvées par le conseil », this school year) and the 10 latest shared or approved items, read
under row level security since the direction is school staff (D-065); the school's AI totals this
month (`ai_usage_summary`); and the latest five alert-access entries of the audit log (D-103). It
shows no units, lessons, progress, class-mode sessions or results, and no per-teacher tallies.
**Assumption:** contributions are credited as on the item page, without counts per teacher,
because a count per teacher reads as monitoring. _Why:_ a principal at 7:45 needs to know who is
away and whether the day is covered; teachers' planning stays theirs (D-013).
As built (slice S5, `server/queries/direction.ts`): one section per school the person directs,
with four cards. « Absences aujourd'hui » (Teaching module only) uses `loadSubBoard(school, today,
{ access: false })` (codes and devices as counts, statuses as text badges, the next school day
folded away; on a day without school the next school day is shown open) and links to
« Suppléances ». « Accès aux alertes (7 derniers jours) » is `list_audit_entries({schoolId,
category: 'alerts', from})` with five entries, `from` being the school's midnight six days before
today, then « Voir le journal d'audit » (`/audit?school=…&category=alerts`). « Contributions à la
banque de ressources » (Library module only) counts the school's items `teacher_reviewed` with
scope `school`, scope `board`, and `board_approved`, updated since the start of the latest school
year that has begun (`school_years`; without one, the last 365 days, and the card says « Depuis
le … » only), then lists the 10 latest credited as on the item page (« Banque de mots · Mme
Tremblay », or « Ressource du conseil scolaire »). « Utilisation de l'IA ce mois-ci » shows the
totals of `ai_usage_summary`. Local dates reach the database as « YYYY-MM-DD 00:00:00 <zone> »,
so the instants are computed there (D-009).

**D-103 — Audit viewer: a catalogue with four audiences, the raw table closed, one database
function (amends D-013, D-017 and D-056).** `public.audit_action_catalog (action, category,
audience)` says who may read each action: `direction` (the school's principal and vice-principals
only: alerts, absences, substitute plans, codes, sessions and reports, class-team changes, class
deletions and student purges), `direction_board` (the school's direction and the board's admins:
role changes, staff access, the AI and alert switches, audit exports), `board` (board admins only:
library approvals, reviewers, packs and bulk runs, the operator's access and settings changes,
retention runs, cancelled invitations) and `operator` (nobody through the API: a teacher's private
professional activity, i.e. library drafting and sharing steps, AI generation, class mode, the
terms). Board admins therefore never see sick days, substitute activity or alert entries (D-056:
"board admins see none of it"; D-013: "no student data"). `select` on `audit_log` is revoked from
`authenticated` and its policy dropped; `public.list_audit_entries` (security definer) is the only
reader, so its predicate is the rule. An action missing from the catalogue is shown to nobody, and
a unit test fails when a migration writes an action without a catalogue row. Labels are computed
per viewer: a person's name only for colleagues (`app.my_colleague_ids()`), a class name only for
classes in `app.my_schedule_class_ids()`, a library title only when
`app.library_item_readable_by(auth.uid(), id)`, plan and absence labels (date and
`app.formal_staff_name`) only for the school's direction, and a student entity only as « Élève ·
<classe> », never a student's name. Details pass a whitelist of scalar keys; `user_id` and
`issued_by` come back as labels. A substitute's entry whose code was issued by the office
(`details.issued_by_role = 'office'`; the allowed values are `owner`, `direction` and `office`)
carries the flag « Code émis par le secrétariat » (D-056). The CSV export holds at most 10,000 rows,
is `;`-separated with a BOM in French and `,` in English, prefixes cells starting with `= + - @ \t
\r` with `'`, and is itself audited (`audit_log.exported`, `direction_board`). A guard trigger
refuses new audit rows whose details hold free-text keys (`first_name`, `note`, `title`,
`message`, `email`…), a string longer than 120 characters, or more than 2 KB. Office staff have no
audit viewer (**Assumption**; SPEC §9.6 names principals and admins only). As built (slice S0):
the catalogue (`20261201090000_pilot_schema.sql`) lists every action the migrations wrote at the
time, including five the plan did not: `library_item.deleted` (Phase 5 hardening; `board`),
`library_item.scope_reduced` (Phase 4 review fixes; `operator`), and
`library_bulk_run.planned`, `.cancel_requested` and `.failed` (`board`); `library_bulk_run.completed`,
`.cancelled` and `.failed` are written as `'library_bulk_run.' || p_status`, which a scan of
literals cannot see.
As built (slice S2, `20261201090200_audit_retention.sql`, pgTAP `05` and `28`):
`public.list_audit_entries(p_filters, p_before_id, p_limit)` takes the filters `schoolId`,
`boardId`, `from`, `to` (`to` excluded when given; without it the period runs up to now, included;
`from` defaults to 30 days before `to`; at most 366 days), `category`, `actorUserId`, `actorType`
and `entityId`; a malformed filter, an unknown category or a limit outside 1–1000 is `22023`;
newest first, `p_before_id` pages by id. Teachers, office staff, people with no role and anyone
whose access was removed get `42501`. The viewer's scope (colleagues, classes, schools, boards) is
computed once per call (`app.audit_viewer`) and every label is checked against it: a person's
display name for colleagues **and the admins of the viewer's boards** (so a principal reads which
board admin changed a role at the school; otherwise « Personne qui n'a plus accès »); a class's
name for classes in `app.my_schedule_class_ids()`, or, once the class is gone, the name its
`class.deleted` entry recorded; a student as their class's name, never theirs; a plan, report or
absence as « 2026-11-12 · Mme Tremblay » (an absence « 2026-11-12–2026-11-13 · … ») for the
school's direction only; a resource's title when `app.library_item_readable_by`; an invitation's
name for the board's admins; a school's name for its staff and the board's admins; a board's name
for its members. The details whitelist also keeps keys written since the plan (`status`,
`ever_approved`, `usage_count` of `library_item.deleted`; `covered`, `error_code` of bulk runs;
the counts of `retention.purged`). `public.log_audit_export(board, school, filters, rows)` (the
school's direction, or an admin of the board; the school's own board) audits `audit_log.exported
{rows, category, from, to}` with at most 10,000 rows. The guard is a plain `before insert`
trigger, so it applies to every writer; every audit write of Phases 1–6 passes it (the whole
pgTAP suite runs with it).
As built (slice S5, `server/audit/{filters,labels,csv,rows}.ts`, `server/queries/audit.ts`):
« Journal d'audit » (`/audit`) reads its address `?school&board&from&to&category&actor&type&entity&
before`. The scope is a school the person directs, or a board they administer (optionally narrowed
to one of its schools); people with neither get « Page introuvable » (404 for the export). The
period is in the scope's local dates, both ends included: by default the last 30 days, at most
365 days (not 366: a period crossing a daylight-saving change would otherwise pass the database's
366-day bound by an hour). 50 entries a page, paged by id (« Entrées plus anciennes »); each entry
links to « Historique de cet élément » (`entity`). Board admins open it from the « Journal
d'audit » tab of « Conseil » (always `/audit?board=…`), which shows the board's intro and offers
the board's categories only (`BOARD_CATEGORIES`; the direction's are `DIRECTION_CATEGORIES`, and a
unit test checks both against the catalogue's audiences). Each of the 60 actions someone may read
has a sentence `audit.actions.<action>` in both languages; `server/audit/catalog.test.ts` scans
every `app.log_audit(…)` call of every migration, expands `'library_bulk_run.' || p_status` with
the values the same function allows for `p_status` (and fails on any such prefix whose values it
cannot find), and checks that every action has a catalogue row and every readable one its
sentence. A person the viewer may not read is « Personne qui n'a plus accès » (an invitation's
invitee « Personne invitée »); a substitute's entry says « code émis par Julie Bergeron
(secrétariat) » and carries the badge « Code émis par le secrétariat ». The CSV
(`/audit/export`, a plain link) holds the filters' period without the paging, newest first, at
most 10,000 entries read 1,000 at a time, with the plan's columns (the time as « YYYY-MM-DD HH:MM »
on the scope's clock, details as sorted `key=value; …`); `log_audit_export` is called once the
file is built, and no file is sent when it fails.

**D-104 — AI usage rows are private to their author; totals are served by definer functions
(amends D-040 and D-046).** `ai_generations_select` becomes `user_id = app.active_user_id()`. The
direction keeps `ai_usage_summary(school)`; board admins get `public.board_ai_usage(board, month)`:
per school, requests, failures and cost, with the board's bulk runs (no school, D-096) on their own
line, month boundaries in each school's time zone. No screen or API shows who used AI how much.
_Why:_ per-person AI use is a teacher's professional activity (D-013); the web app never read the
rows, and the admin CLI uses the service role.
As built (slice S2): `board_ai_usage(board, 'YYYY-MM')` returns every school of the board (zeros
included), then the bulk line (null school, in `boards.default_timezone`) only when it has
requests; failures count `failed` and `invalid_output`. The library's item details embed
`ai_generations(feature)` for the provenance line: since this change only the item's author reads
the feature, and everyone else sees the prompt version alone, as teachers already did for
colleagues' items.
As built (slice S4): « Utilisation de l'IA » (`/board/usage?month=YYYY-MM`, the board's current
month by default) shows `board_ai_usage` per school with a total, as cards on phones and a table
from `md:`; « Télécharger (CSV) » (`/board/usage/export`, `private, no-store`) writes the same rows
with a byte order mark, `;` and a decimal comma in French, `,` in English, and a `'` before any
cell that starts like a formula (`apps/web/src/server/csv.ts`, there for the audit export too).

**D-105 — Retention implemented (implements D-018 and D-059; per-board settings, operator-only;
Assumptions on the defaults, pending a lawyer's review).** The worker's nightly
`retention_maintenance` (`53 3 * * *`, after the other clean-ups) calls
`app.retention_maintenance()`, which purges, per board (`boards.settings.retention`, read with
`app.retention_days`):

| Data                                                                                                                                                                                                                                                      | Kept                                        | Setting (bounds)                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Audit log                                                                                                                                                                                                                                                 | 730 days                                    | `auditDays` (365–3650)                                                                     |
| Substitute plans, with their classes, codes, sessions and report (cascade); the report's `pending_confirmation` progress is deleted as when a class is deleted, confirmed progress stays                                                                  | 365 days after the plan date (school-local) | `subPlanDays` (365–1095)                                                                   |
| Absences with no plan left                                                                                                                                                                                                                                | the same, after their last day              | `subPlanDays`                                                                              |
| A class's student data: first names, levels, alerts (cascade), plans covering it, the class link (D-084); units, lessons, timetable and progress stay; `classes.students_purged_at` is set; at most 200 classes a night; teachers are told 60 days before | 365 days after its school year ends         | `classDaysAfterYearEnd` (365–1095)                                                         |
| Sample classes (D-109), whole                                                                                                                                                                                                                             | 60 days after creation                      | —                                                                                          |
| AI usage ledger (`ai_generations`)                                                                                                                                                                                                                        | 730 days                                    | `aiUsageDays` (365–3650)                                                                   |
| Feedback (D-116)                                                                                                                                                                                                                                          | 365 days                                    | `feedbackDays` (365–1095)                                                                  |
| Dispatched outbox events                                                                                                                                                                                                                                  | 90 days                                     | —                                                                                          |
| Invitations (D-107): pending ones fail as `expired` after 14 days; processed ones are deleted after 90 days                                                                                                                                               | —                                           | —                                                                                          |
| Supabase Auth's audit entries (`auth.audit_log_entries`: e-mails, IP addresses)                                                                                                                                                                           | 90 days                                     | — (skipped with `"authLogs": "not_permitted"` where the database role may not delete them) |

API users cannot change `settings.retention` (a trigger, as for `settings.ai`); the operator uses
`pnpm admin set-retention`. Every lower bound is 365 days because MFIPPA Reg. 823 s.5 may require
keeping personal information a year after its use; D-059's 60-day purge of report free text goes
to the lawyer too. Each run writes one `retention.purged` audit row per board with counts, and the
`retention` heartbeat (D-112). The existing jobs stay (`ai_maintenance`, `sub_access_maintenance`,
`class_mode_maintenance`, `library_maintenance`). Deleted rows survive in backups for at most the
backup window (D-115). As built (slice S0): the bounds and defaults are `RETENTION_LIMITS`
(`packages/domain/src/settings.ts`); a value outside them, or not a number, reads as the default,
and a fraction is rounded as SQL rounds it. `studentPurgeDate` is the day after the year end plus
`classDaysAfterYearEnd` (the job purges once that sum is before the school's date),
`samplePurgeDate` the creation date plus 60 days, and `showsPurgeNotice` covers the 60 days before
a purge and the day itself (`packages/domain/src/retention.ts`).
As built (slice S2, `20261201090200_audit_retention.sql`, pgTAP `29`, worker
`src/retention.ts`): the bounds live once in `app.retention_limits()` (a unit test compares them
with `RETENTION_LIMITS`); `app.retention_days(settings, key)` reads a setting as the app does. The
guard refuses API users (`42501`) and, for the operator, unknown keys, fractions, strings and
anything but an object (`22023`); `pnpm admin set-retention --board … --audit-days …` checks the
same bounds first, merges the given keys into `settings.retention` and prints what the board keeps.
`app.retention_maintenance()` takes an advisory lock (one run at a time) and works board by board:
plans (`app.purge_sub_plan(plan, reason)`, also usable by other purges), absences, classes
(`app.purge_class_students(class)` returns the students and plans it removed; a class is purged
again if students, a class link or a plan came back after its purge), sample classes (local dates,
as `samplePurgeDate`), usage, feedback, invitations (expired through `app.fail_staff_invitation`),
then the board's audit rows, and writes `retention.purged {sub_plans, absences, classes, students,
sample_classes, ai_usage, feedback, invitations_expired, invitations_deleted, audit_rows}` when
something went; then for everyone the outbox, usage and audit rows without a (live) board after the
defaults, and Supabase Auth's log (`app.auth_log_maintenance(90)`, `-1` when refused). It returns
and records in the heartbeat `{boards, subPlans, absences, classes, students, sampleClasses,
aiUsage, feedback, invitationsExpired, invitationsDeleted, auditRows, outbox, authLogs}`; the
worker logs exactly these. A class keeps its « Fiche de suppléance » and its kept class-mode
results (aggregates without names; D-089 has their own retention) with its planning.
_Amended in Phase 6 review (2026-10-02):_ the class purge deletes only the plans of the class's own
school year (`plan_date <= ends_on`); a later plan that still lists the class (built before D-055's
amendment) only loses that `sub_plan_classes` link, and the « purge again » check looks at plans of
that year only, so a current plan is never deleted night after night. Teachers always get their 60
days of notice: the first night a class is within 60 days of its purge date is recorded
(`classes.students_purge_notice_on`, cleared if the dates move the purge out of the window again)
and its students go once both the purge date and that night plus 60 days have come
(`classPurgeDate`, used by the notices). A year edited into the past, or a shorter setting, delays
the purge instead of running it that night. The run also deletes staff sign-in attempts after two
days (D-121) and returns `signInAttempts`. pgTAP `32`.
_Amended for « Mon année » (2026-10-02):_ a unit's planned window and its attentes
(`unit_expectations`) are the teacher's planning: kept when the class's students are purged,
deleted with the unit or class (and with a sample class); report periods hold no personal data and
go with their school year or board (D-123, D-124). No new job or setting.
_Amended for « Commentaires de bulletin » (2026-10-03):_ no new job or setting. Comment banks are
library resources (kept until the author deletes them; « Créer une banque avec l'IA » requests are
`ai_jobs`, 30 days). Report card comments never reach the server: the device removes them at
sign-out, when another account signs in on that browser, or 60 days after the « remise » (D-130).
The class purge cannot reach a device and does not need to: the expiry comes long before.
_Amended for « Info-parents » (2026-10-03):_ the class purge also deletes the class's
« Info-parents » messages (`class_newsletters`; the `class.students_purged` entry counts them as
`newsletters` when there were some), and a purged class takes no new message (`LXN02`), so the
« purge again » check needs no new clause (D-138). No new job or setting.

**D-106 — Operator actions are visible to the board.** Triggers audit changes to `boards.settings`
keys `ai` and `retention` (`board.settings_changed {keys}`), to `module_entitlements`
(`school.module_changed {module, enabled}`) and to `ai_budgets` (`school.ai_budget_changed
{monthly_allowance_usd, monthly_ceiling_usd}`), with actor type `service` when `current_user =
'service_role'`. `pnpm admin log-operator-access --board x --reason
support|incident|restore|migration` writes `operator.access`; `DEPLOYMENT.md` makes it mandatory
before any access to production data. The board's admins see all of these (D-103, `board`). _Why:_
the operator holds the service role; the board must be able to see what was done to its data.
As built (slice S1): `public.log_operator_access(board, reason)` (service role only) refuses any
other reason (`22023`) and writes `operator.access {reason}` for the board with actor `service`.
As built (slice S2): the actor is `service` when the `role` setting is `service_role` (it stays
visible inside definer functions), otherwise the signed-in user, or the system for the database
owner. Modules are audited on insert, delete and a change of `enabled` or of their validity dates
(so creating a school writes one entry per module), but not while their school is being deleted;
budgets on insert and on a change of either amount.

**D-107 — Board admins manage the staff of their own board in the web; the worker creates Auth
accounts; the inviter sends the message (amends D-004; D-012 unchanged, as it already allows the
worker the service role).** « Inviter une personne » calls `invite_staff` (board admin of that
board): an unknown address records a pending invitation and emits `staff_invitation.created
{invitationId}`; an active person whose roles, class teams and absences are all within the caller's
admin boards gets the role at once; such a person whose access was removed goes through the worker,
which restores access; anyone with a role, class team or absence elsewhere, or with no role at all,
fails at once as `emailConflict` (no name is copied from the existing account, no role is granted:
the operator resolves it); inviting oneself is `LXU07`. The worker creates the Auth user (confirmed,
no e-mail sent) or finds it, calls `app.complete_staff_invitation` (which checks again for
conflicts and cancellation), and only then unbans the account; an Auth user it created for an
invitation that was cancelled or conflicts is deleted again. **No invitation e-mail leaves our
servers:** the page prepares a French or English message and the inviter sends it with « Courriel »
or « Texto » from their own apps, as for substitute codes (D-059). Roles: grant within one's board
to people who already hold a role in it, never to oneself (`LXU07`); revoke, but never the board's
last active admin (`LXU01`) or a person's last role (`LXU08`, so nobody drops out of every list).
Access: remove and restore, never one's own (`LXU05`), never for someone with a role, class team or
absence outside the caller's admin boards (`LXU02`), never the last active admin (`LXU01`); the
worker then bans or unbans the Auth account (`staff.access_changed {userId}`). Deleting an account
is the operator's, on request (`pnpm admin delete-user`): refused while it is active (`LXU06`) and
for a person in several boards unless `--all-boards` (`LXU02`); deleting a board likewise
(`delete-board`). Principals do not invite (**Assumption**). _Why:_ one e-mail path (Supabase
Auth's sign-in codes), no one-time link for mail scanners to use up (D-019), and the service role
stays out of the web server.
As built (slice S1, `20261201090100_pilot_accounts.sql`, pgTAP `27`): a person works in a board
through a role, a class team or an absence (`app.staff_board_ids`); someone with no role at all
counts as working elsewhere. `invite_staff` returns `(invitation_id, status, error_code)`; a person
whose access this board removed is restored by the worker's `app.complete_staff_invitation`
(`staff.access_restored {via: 'invitation'}` per board and school of their roles), which answers
`ready`, `cancelled`, `conflict`, `failed` or `gone`; `app.fail_staff_invitation` records
`authNotConfigured`, `authRefused`, `emailConflict` or `expired`. Both are the database owner's
only. **A person is named by one of their roles in the caller's board** (`user_roles.id`), never by
a user id: `grant_staff_role(p_role_id, p_role, p_school_id)` adds a role in that role's board,
`revoke_staff_role(p_role_id)`, `set_staff_active(p_role_id, p_active)` and
`set_library_reviewer(p_role_id, …)`; so no function signed-in users may run takes a user id (the
Phase 4 rule; pinned by pgTAP `27`, the one exception being Phase 1's class-team check). An admin
may give up their own roles while another active admin remains (`LXU01`) and the person keeps a role
(`LXU08`); only granting oneself a role is `LXU07`. Revoking a person's last role in a board also
removes their reviewer designation there. Board admins designate the board's library reviewers in
the web (amends D-064). `set_staff_active` changes nothing when the person is already in that state,
and changes to a board's admins are serialized so two admins cannot remove each other.
`board_staff_sign_ins(board)` says whether each person ever signed in, never when. The operator's
`delete-user` finds the account with `operator_account_id(email)` (the address in the request body,
D-119); `operator_delete_staff_account` also deletes the plans of the person's absences (the
report's unconfirmed lessons first, `sub_plan.deleted {reason: 'account_deleted'}`) and their sample
classes; `operator_delete_board` deletes the board's resources and classes, then the board, the
profiles of the people who worked only there, and the board's audit rows; the CLI then deletes their
Auth accounts.
As built (slice S4, `apps/web/src/{server/queries/board.ts,server/actions/board.ts,components/board}`,
worker `src/{auth-admin,staff}.ts`): « Personnel » lists everyone with a role in the board
(« Active », « Jamais connectée », « Accès retiré ») and the invitations being prepared or that failed
in the last 30 days; « Inviter une personne » offers the board's own schools only (none for an
admin) and the message's language. The invitation page asks every 1.5 s while the worker works
(`role="status"`; after 90 s it says it is slow and offers « Vérifier de nouveau »), then gives the
French or English message (`server/invite-message.ts`: the sign-in address, the e-mail address to
type and the 6-digit code, no link to click; « Courriel » is a `mailto:` to the person, « Texto » an
`sms:` body, « Copier le message »), or says that a colleague of the board now has the role (the
invitation was ready in the transaction that made it), or why it failed. « Fiche de la personne »
(`/board/staff/[userId]`; every change still names the person by one of their roles in the board)
removes and adds roles and removes or restores access; removing a teacher role warns that the
person's classes there stay out of reach (without their number: board admins cannot read classes);
deletion is a `mailto:` to `SUPPORT_EMAIL`. The worker calls Auth's admin API with a 10 s limit per
request and sorts its errors into `transient` (no answer, 408, 429, 5xx: retried), `exists`,
`notFound` and `refused` (any other 4xx: `authRefused`). It creates accounts with the
`authenticated` role explicitly: the lite stack's Auth had no default group and gave accounts made
through the admin API an empty role, which PostgREST refuses (the lite stack now sets
`GOTRUE_JWT_DEFAULT_GROUP_NAME`, as the CLI and Compose do). A provisioning run holds an advisory
lock on the address and a ban sync one on the person, so two deliveries of an event, or two boards
inviting one address, never interleave; an account the run created is deleted again only while no
profile uses it; on `ready`, an account that already existed is made to match the profile
(unbanned). Both handlers read the current state, so a restore may hand their events back
(D-115).
As built (slice S7, `20261201090400_phase6_security_review.sql`, pgTAP `31`): the operator's `pnpm
admin deactivate` and `invite` used to change the profile directly, unaudited; they now go through
`public.operator_set_staff_active(user, active)` (service role only), which does what « Retirer
l'accès » and « Rétablir l'accès » do (one `staff.access_removed` or `staff.access_restored` per
board and school of the person's roles, with actor `service`, so the board's admins and the school's
direction see it; upcoming plans refreshed; `staff.access_changed` for the worker) for any account,
the last admin of a board included. The CLI still bans or unbans the sign-in at once. Every CLI
command that takes an e-mail address (`invite`, `deactivate`, `set-library-reviewer`, `delete-user`,
`import-pack --approver`) finds the account with `operator_account_id` (the address in the request
body) and names it by id afterwards (`accountIdByEmail`, `apps/admin/src/context.ts`; a unit test
runs each command against a recording fake of the API and finds no address in any URL). `invite`
creates the Auth account with the `authenticated` role, as the worker does.
_Amended in Phase 6 review (2026-10-02):_ a job holds one database connection at most: everything
under an advisory lock runs on the lock's connection, and the ban sync of an invitation runs on the
connection holding the address's lock (nested checkouts could take the whole pool, stop every job
and the heartbeat); the pool fails a checkout after 30 s (`CONNECTION_TIMEOUT_MS`) instead of
waiting forever. A delivery of `staff_invitation.created` for an invitation already `ready` syncs
its account's ban again, so an unban that failed after the invitation completed is retried with the
job (and a restore's hand-back repairs it too). `app.complete_staff_invitation` reads the inviter's
admin boards from active roles only: an invitation left pending by someone who no longer administers
its board is cancelled (`staff.invitation_cancelled`, actor system). `pnpm admin delete-user` also
deletes the person's invitations, in every board, by account and by address.
_Amended in Phase 6 review, round B (2026-10-02):_ the board's pages no longer name IP Lynx as the
one who deletes accounts, adds schools, sets budgets or retention: board-hosted, the board's IT runs
the command line. They say « la personne qui gère le serveur », and the person's page links to
`SUPPORT_EMAIL` (« Demander la suppression ») only when it is set. The words match « État du
système » (S7).
_Amended for « Mon année » (2026-10-02):_ the board's admins also set each school year's report
card periods (« Périodes de bulletin », D-124).

**D-108 — What board admins may change on a school (amends D-039).** Allowed: contact details and
bell times, through `public.merge_school_settings`, which merges keys atomically (no
read-modify-write races, and the substitute settings are written the same way), and the AI switch
(**Assumption:** needed in beta schools with no direction account). The direction only: the alerts
switch (a trigger raises `42501` when an API user without a direction role at that school changes
`student_alerts_enabled`) and the substitute settings. The operator only (CLI): school creation,
modules, budgets and retention; school creation stays in the CLI because every new AI-enabled
school adds its allowance to the board's pool (D-040).
As built (slice S1): `merge_school_settings(school, patch)` takes `contact` (`officePhone`: at most
40 of `0-9 +().-`; `officeEmail`; blank or null clears a value), `dayStart` and `dayEnd` (`HH:MM`,
the first bell before dismissal, a missing value read as the app's default) and `substitute` (the
direction only; at most 8 KB of short strings or nulls, its times `HH:MM`), merged under a row lock.
The guard trigger (`app.schools_guard_direction_settings`) covers the alerts switch and the
substitute settings, so a board admin cannot change either through a direct update either.
As built (slice S4): « Coordonnées et heures » (`components/board/school-contact-card.tsx`) is on
« École » for the direction (office staff read it) and on the board's page of the school
(`/board/schools/[schoolId]`), next to the AI switch (« Normalement décidé par la direction de
l'école ») and, read only, the schedule, the modules and the alerts switch's state. The
direction's « Suppléance » card now saves through `merge_school_settings({substitute})` instead of
reading and rewriting the whole settings object. Board-wide calendar events (« Tout le conseil ·
… ») are the board's admins' (`calendarEventFormSchema` takes `boardId` or `schoolId`, exactly
one), and their « Calendrier » can delete any event of their board but a class's.

**D-109 — Teacher onboarding: the terms at first sign-in, a checklist computed from data, a sample
class kept out of plans (Assumption on its content).** `requireSession()` sends a person who has
not accepted the pilot terms (`users.terms_accepted_at` null) to `/bienvenue?next=…`, for pages,
server actions and route handlers; « Bienvenue » and its actions use `requireSession({ beforeTerms:
true })`. A newer `CURRENT_TERMS_VERSION` shows a banner and never blocks, so a sick teacher at 6
a.m. is never stopped. The « Pour bien commencer » checklist (on « Aujourd'hui » and `/demarrage`)
counts, under row level security, the teacher's real classes, students, timetable blocks and
active units with lessons; « Masquer » stores `users.onboarding_dismissed_at`. « Essayer avec une
classe exemple » builds a « Classe exemple (3e année) » or 5e (`buildSampleClass`, `@lynx/domain`:
20 invented first names, the seed's weekly timetable, a Français and a Mathématiques unit of 8
lessons with lessons 1–3 done) and saves it with `public.create_sample_class`, a security invoker
function, so row level security and column grants check every row; only the small definer
`app.mark_sample_class` sets `classes.sample_owner_id`. One per teacher and school (a unique
index). `app.teacher_class_ids` leaves sample classes out, so they never reach plans, codes or the
plan-source check (amends D-055). Their invented names join the prompts' first-name guard fixture,
and they are deleted 60 days after creation (D-105). As built (slice S0): the seed's demo accounts
have accepted the current terms (`supabase/seed.sql`), so demos and browser tests go straight in;
`termsState(version)` (`packages/domain/src/legal.ts`) says `required`, `outdated` or `accepted`;
`terms_version` and `terms_accepted_at` are set together or not at all (a check).
As built (slice S1): `accept_terms(version)` (active users; the version's pattern, else `22023`)
sets both columns and audits `user.terms_accepted {version}` for no board. `create_sample_class`
refuses who does not teach at the school (`42501`), uses the board's current school year (else the
latest; none is `LXO01`), and checks the payload's shape and size; `app.mark_sample_class` accepts
only a class the teacher created in the last 10 minutes, without students.
As built (slice S6): `requireSession()` reads the page asked for from the `x-lynx-path` header,
which `proxy.ts` sets on every request (overwriting a client's value, without Next's `_rsc`), so
the gate sends to `/bienvenue?next=<page>`; `next` is kept only when it is a local page other than
« Bienvenue » (`lib/request-path.ts`), else the person's landing page. « Bienvenue » is one page
with two sections (« Votre vie privée et le projet pilote », then « Votre profil ») and one
« Commencer »; its inputs are uncontrolled and the button waits for the page to be ready, so what is
ticked before then is kept and the form never submits itself as a GET. `acceptTerms` saves the
profile first, then `accept_terms` (only `CURRENT_TERMS_VERSION`, the text shown); newer terms show
`TermsBanner` at the top of every app page, and « Lire et accepter » opens « Bienvenue » with the
terms alone. The checklist (`loadTeacherOnboarding`) is a card on « Aujourd'hui » until it is done
or hidden, and the page `/demarrage`; « Essayer avec une classe exemple (3e) » / « (5e) » builds
the class for the school's schedule (`buildSampleClass({gradeCode, today, dayCount})`: 5 day keys
at a weekly school, the cycle's length at a rotating-day school, where the week repeats; long
cycles keep only the periods, within the 80 blocks `create_sample_class` accepts). Its 20 names
(`SAMPLE_FIRST_NAMES`) are none of the demo's people or the AI's character names, and every prompt
passes the outbound check with them (`packages/ai/src/prompts-privacy.test.ts`). « Exemple » shows
on the class list, the class pages (so Planification) and the sample's lessons on « Aujourd'hui »;
the class pages say when it is deleted, with « Supprimer la classe exemple »; the absence form says
it is not in substitute plans; the year-end notice (D-105) shows on the class pages and
« Aujourd'hui » 60 days before. **A sample class never shows in the direction's « Journal
d'audit »** (lead's decision): its deletion, by the teacher or the nightly purge, is logged as
`sample_class.deleted` (audience `operator`, no details), never `class.deleted` (« Classe
supprimée »), and its class team is not logged (`app.class_teachers_guard` skips sample classes,
and `create_sample_class` names the teacher being added in the transaction-local
`app.sample_class_setup` around `create_class`, before the class is marked)
(`20261201090300_onboarding_feedback.sql`; pgTAP 30).
As built (slice S7): colleagues could read every column of each other's profiles, the terms' version
and acceptance time and the checklist's dismissal included; the time of the terms' acceptance is
about when a person first signed in, which « Personnel » deliberately never shows. `select` on
`users` is now granted on `id`, `email`, `display_name`, `honorific`, `preferred_locale` and
`deactivated_at` only (`created_at` and `updated_at` went too: accepting the terms moves
`updated_at`), and a person reads their own three values through `public.my_onboarding_state()` (the
session and the sign-in action use it; a failed read is an error, never a second « Bienvenue »).

**D-110 — Pilot terms and privacy notice.** The public page « Confidentialité et conditions »
(`/confidentialite`) holds the plain-language notice (from `PRIVACY.md`) and the pilot terms, in
French and English. The acceptance is stored (version and time) and audited as
`user.terms_accepted` (`operator`). Substitutes see one line on the code screen (« …chaque
consultation est enregistrée. »), no click-through. `PRIVACY_CONTACT_EMAIL` and `SUPPORT_EMAIL` are
shown when set. **Assumption:** the wording is ours until an Ontario privacy lawyer reviews it.
As built (slice S6): `/confidentialite` (public, dynamic for `APP_NAME`) is linked from the login
page, « Bienvenue », the app's footer and the substitute portal's footer; the code screen carries
the one line. The texts are the `legal` messages; `PRIVACY.md` (slice S7) must say the same.
As built (slice S7): `PRIVACY.md` is written from the `legal` messages and says the same, in more
detail for a board's privacy officer. The notice's « Qui y a accès » now names every reason IP Lynx
may access the data (support, an incident, a restore, an upgrade), as `log-operator-access` records
them; the terms did not change, so `CURRENT_TERMS_VERSION` stays.
_Amended in Phase 6 review (2026-10-02):_ newer terms say what changed in one line (« Ce qui a
changé : … »): each version has a key in `TERMS_CHANGES` (`packages/domain/src/legal.ts`) and its
line under `welcome.changes` in both catalogues (unit tests check both). The newer-terms page has «
Plus tard », back to the page the person came from with the banner still shown: it never blocks,
even in the installed app, which has no Back button.
_Amended in Phase 6 review, round B (2026-10-02):_ new terms, `2026-10-pilote-2`, because the notice
and « Bienvenue » change meaning: the AI paragraph states the limit (D-038) and that Anthropic may
keep the text for a limited time; « Où sont les données » says the AI text is the only thing
processed outside Canada; « Qui y a accès » says recording each access is IP Lynx's commitment and
that IP Lynx may hold the board administrator role during the pilot; « Combien de temps » gives the
defaults (« Par défaut », and the board may ask for others); the feedback term names the readers
(D-116). « Bienvenue »: « La protection des renseignements et le projet pilote », the AI point
with its limit, and « Les données sont conservées au Canada. Seul le texte envoyé à l'intelligence
artificielle est traité aux États-Unis. » The seed's accounts accept the new version; everyone
else sees the banner and « Ce qui a changé » (`welcome.changes.pilote2`).
_Amended for « Commentaires de bulletin » (2026-10-03):_ terms `2026-10-pilote-3` (D-134): the
notice, the terms and « Bienvenue » say that report card comments stay on the teacher's device.

**D-111 — Error monitoring for the pilot: scrubbed structured logs and error references; no
third-party error service.** `@lynx/observability` gives `createLogger` (JSON lines on stdout),
`scrubText` and `scrubError`; `scrubError` builds `{name, code?, digest?, message:
scrubText(message), frames[]}` and never enumerates an error's own properties (a privacy error's
`findings` hold names). Server errors reach the logs from `instrumentation.ts#onRequestError`
(route template and type only) and `reportError`; worker failures from `runner.events`
`job:failed` and graphile-worker's own logger, replaced by a scrubbing one; browser errors through
`/api/client-error`, as a name, a digest or a random reference, the route template and a
16-character SHA-256 of the message (the message itself can contain page text). Error pages show
« Référence : … », which feedback carries, so a report can be matched to a log line.
`NEXT_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` in every image. _Why no GlitchTip:_ it needs
Postgres and Valkey on the pilot server for a handful of users; the logs stay in Canada for 14
days (D-119). `ERROR_REPORTING_DSN` is documented as a later hook.
As built (slice S3a): `createLogger` scrubs every string of a line (`scrubText`) and reduces every
error to `scrubError`, whatever a caller passes, so a careless `{ error: err.message }` cannot
reach the logs; only the error reference (`digest`, `ref`) and a browser's `messageHash` are kept
as they are when they have the expected shape. In production, `register()` also replaces the
console (`guardConsole`): Next prints a failed request's error with `console.error(error)`, which
shows its raw message and every own property, so console output becomes scrubbed lines too, and
the copy of an error `onRequestError` already logged is dropped (Next 16 prints first, so a printed
error is held 250 ms; held lines are written at exit). The result is one line per failed request
with the route template (`/classes/[classId]`), its type and the digest the page shows. Browser
reports are sent with `fetch(…, { keepalive: true })`, not `sendBeacon`: a beacon's `Origin` is
`null` on pages sent with `Referrer-Policy: no-referrer` (the substitute portal, class devices),
and the endpoint accepts its own origin only; it also refuses any report with a message field.
The worker's graphile-worker logger is replaced (its metadata holds the job's payload: only the
error is kept), its console is guarded the same way, and a job that failed for good gets one line. Every error page shows « Référence :
… » (`global-error.tsx` in both languages, since it has no translations); route templates turn
ids into `[id]` and any segment that is not a route name into `[x]`.
As built (slice S6): « Signaler ce problème » on every error page. In the app and on the projector,
it opens « Commentaires » with the reference filled in (one `FeedbackProvider` per signed-in shell);
on the substitute portal it says to give the reference to the school office, and on class devices
to show it to the teacher (the `problemReport` messages, served on `/jouer` with `classPortal`);
`global-error.tsx` links to `/commentaires?ref=…`, a page of its own (the reference is kept only
when `isReference`). `feedback.error_ref` now accepts a Next digest's `@E…` suffix.
As built (slice S7): a browser that leaves while a page is still streaming makes Next report « The
destination stream closed early. »; that is now an `info` line (« request ended by the browser »,
route and type only), so `error` lines are faults to look at. Only Next's own message counts: a
reset connection or an aborted call inside the server stays an error. The scrubber was checked
against error texts captured from the local stack (PostgreSQL's DETAIL lines with an address and a
whole failing row, PostgREST and Auth error bodies, a sign-in link with its token, a Zod error with
its input; `packages/observability/src/real-samples.test.ts`); a first name in free text is still
not recognized, which is why errors never carry what people typed.
_Amended in Phase 6 review (2026-10-02):_ `ERROR_REPORTING_DSN` was never added anywhere; a later
error service would bring its own setting. Board-hosted, Auth and the database write their own,
unscrubbed lines to the same journal: D-119 as amended says what they hold.

**D-112 — Health, heartbeats, external checks and « État du système ».** `/api/health` is liveness
only; `/api/health/ready` checks Auth (`/auth/v1/health`), PostgREST and the portals' pools when
configured, answers 503 when degraded and never gives details. The worker's heartbeat is an
in-process timer every 60 s, not a graphile-worker job, so long AI jobs cannot starve it: it calls
`app.record_heartbeat('worker', release, {lastDispatchAt})` and pings `HEARTBEAT_URL_WORKER`; its
`/healthz` (`WORKER_HEALTH_PORT`) answers 200 while the last tick succeeded less than 180 s ago.
`public.system_heartbeats` holds rows for `worker`, `retention` and `backup`;
`public.system_status()` gives board admins a state (`ok`/`problem`) and three times, never counts,
because the hosted install serves several boards; `public.operator_status()` gives the operator the
counts (service role, `pnpm admin status`). Monitoring runs off the server: an HTTP check of
`/api/health/ready` and heartbeat checks for the worker and backups, which receive only URLs and
pings. One named on-call person gets the alerts: urgent when the web is down 06:00–17:00 on school
days; next morning when the worker is down (publishing still works, D-047) or a backup was missed.
As built (slice S2, worker `src/health.ts`, pgTAP `29`): the worker beats once at start, then every
60 s; a beat still running is not started twice; the release is cut to 40 characters; a failed
beat is logged once per run of failures, with its error code only; the monitor is pinged only after
a beat the database took. `/healthz` answers `{"status": "ok"}` or `{"status": "unavailable"}`
(`no-store`) and 404 for anything else; it is healthy while the last successful beat is less than
180 s old. `system_status()` returns `{state, worker: {ok, at}, backup: {ok, at}, retention: {ok,
at}}`; a backup or retention job that never ran counts as a problem only once the install (its
oldest board) is more than 26 hours old. `operator_status()` returns `{at, heartbeats[], outbox
{pending, oldestPendingAt, failing}, aiJobs {queued, running, failedLastDay}, invitations
{pending}}`, printed by `pnpm admin status`.
As built (slice S3a): `/api/health` answers `{"status": "ok", "release": …}`; `/api/health/ready`
checks Auth's `/auth/v1/health` (200), PostgREST with a `HEAD` of `/rest/v1/` (up below 500, so a
refusal of the anonymous key still counts as up) and `select 1` on each configured portal pool
(without waiting at the class portal's gate), each cut off after 2 s, and answers `{"status":
"ok"}` or 503 `{"status": "unavailable"}`; the server logs which checks fail, once each time
that set changes. Both are `no-store`, dynamic, and skip the session (`proxy.ts`).
As built (slice S4): the « État du système » card on « Conseil » says « Tout fonctionne
normalement » or « Un problème a été détecté : IP Lynx a été avisé », then when the background
service, the backup and the data clean-up last ran, in the board's time zone (« il y a 4 min »,
« il y a 6 h », « hier 23 h 53 » for the evening before, else the date; `lib/relative-time.ts`),
each followed by « normal » or « à vérifier » in words; it says the state is unavailable when
`system_status()` cannot be read.
As built (slice S7): the card said « IP Lynx a été avisé », which nothing guarantees (the card
notifies nobody, and on a board's own servers IP Lynx does not run the install); it now says « Un
problème a été détecté : signalez-le à la personne qui gère le serveur. » The external monitors and
the on-call person are deployment steps (`DEPLOYMENT.md`).
_Amended in Phase 6 review (2026-10-02):_ on a new install, a backup or clean-up that has not run
yet (and that the database does not count as a problem yet) reads « pas encore (… cette nuit) » with
« prévu », never « jamais » next to « normal » (`systemLineState`).

**D-113 — Run-time configuration: no `NEXT_PUBLIC_*` in the web app (amends D-002).** The server
reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `APP_NAME` through `serverEnv()` at run time; Next's
build inlined the `NEXT_PUBLIC_*` values (the local build held `http://127.0.0.1:54321`), which made
an image specific to one install. The old names are still read when the new ones are unset
(`@lynx/config`), so an existing `.env` keeps working; the new names win. The browser never calls
Supabase, so nothing needs to be public. An ESLint rule and a CI check forbid `NEXT_PUBLIC_` in
`apps/web/src`, and the CI build uses `SUPABASE_URL=http://build.invalid` and fails if that string
appears in `.next`. Pages that show `APP_NAME` are dynamic (the web manifest too). As built (slice
S0): `lib/app-name.ts` reads `appNameFrom(process.env)` (`@lynx/config`) when the server starts,
not `serverEnv()`, because the PDF renderer that prints the name is unit-tested without the web
server's settings; the admin CLI and the worker read `SUPABASE_URL` with the same fallback; the
CI workflow writes the live local-stack values under the new names.
As built (slice S3a): the ESLint rule (`no-restricted-syntax`, `apps/web/src`) refuses any
identifier, string or template text starting with `NEXT_PUBLIC_` (a unit test pins it), and the
build with `SUPABASE_URL=http://build.invalid` leaves no trace of that address in `.next`.

**D-114 — Deployment: two images configured at run time; hosted is Supabase Pro in Canada Central
plus one Canadian server running Docker Compose; board-hosted is the same Compose plus a minimal
self-hosted Supabase (amends D-029; deviation from SPEC §5 "Vercel").** Images
(`deploy/docker/Dockerfile`): `web`, the Next standalone build; `app`, the whole workspace run with
`tsx`, plus `postgresql-client-17` and `age`, which runs the worker, the admin CLI, `migrate` and
`backup`. `migrate` runs `supabase db push`, sets the portal roles' passwords and reloads
PostgREST's schema; it takes a backup first whenever migrations are pending on a non-empty database
(and refuses without backups configured, unless `MIGRATE_WITHOUT_BACKUP=yes`); web and worker
start only after it succeeds. The worker refuses to start when the database lacks a migration
shipped with it. Board-hosted Supabase runs only what the app uses: `supabase/postgres` 17,
Supabase Auth, PostgREST and a Caddy gateway on the internal network. `deploy/docker/versions.env`
is the only source of production image versions, pinned by digest; only the `docker-smoke` CI job
tests it. Hosted: Supabase Pro in `ca-central-1`, an AWS Lightsail server (4 GB, dual-stack) in
`ca-central-1` running Caddy, web and worker, Amazon SES in `ca-central-1` for sign-in codes,
images built on the server from a tagged checkout. Every service gets only its own variables. _Why:_
one tested artifact for both modes; the worker needs a long-running process; everything that
handles names stays in Canada.
As built (slice S3b, `deploy/`): the base is `node:22.23.3-bookworm-slim`; pnpm is installed with
npm for every user (corepack would fetch it again at run time for the non-root user); the
PostgreSQL 17 client comes from the PostgreSQL project's repository. Both images run as `node`.
The worker runs as one process (`node --import tsx src/index.ts`) so it receives the stop signal
itself; the admin CLI likewise (`docker compose run --rm admin …`). The web build fails if
`http://build.invalid` appears in `.next` outside Next's own build cache (`.next/cache` records the
settings a build saw and is never shipped); the CI web build makes the same check. There is no
`versions.env`: Compose interpolates from `.env` alone, so a second file would need `--env-file`
on every command a board's IT types. The images are pinned by digest in `compose.yml` and
`compose.supabase.yml`, which are therefore the only place production versions are set
(`docker compose config --images` lists them): `supabase/postgres` 17.6.1.171, `supabase/gotrue`
v2.197.0 and `postgrest` v16.3, the versions the Supabase CLI (2.118) runs in CI, plus Caddy 2.11.4
and, for CI only, Mailpit. Our own images (`lynx-web`, `lynx-app`) are built from the checkout and
never pulled (`pull_policy: never`). `generate-secrets.mjs --hosted|--board|--ci [--out]` creates
`.env` itself (mode 0600, never overwritten; a shell redirection would create the file first),
including `COMPOSE_FILE`, so a board install picks `compose.supabase.yml` without flags; it never
generates the backup key. `migrate.sh` runs `supabase db push --skip-vault` with the CLI's telemetry
and update check off, and sends the portal roles' passwords as SCRAM-SHA-256 verifiers computed by
`portal-passwords.mjs`, so a password never reaches the database's logs or a command line. The
self-hosted database's first start sets the Auth and PostgREST logins from `POSTGRES_PASSWORD`
(`db-init/99-lynx-roles.sql`, Supabase's own self-hosting pattern). The schema guard compares
14-digit versions with `supabase_migrations.schema_migrations` and `lite_stack.schema_migrations`
(either counts), names the missing migrations (the logger scrubs bare versions) and refuses when no
migration file ships with it. Caddy: `CADDY_TLS=acme|internal`; its access log also drops
`X-Forwarded-For` and `Set-Cookie`; a board load balancer needs `trusted_proxies` in the Caddyfile
and `TRUSTED_PROXY_HOPS=2`. The host's cron line is in UTC (Ubuntu's cron has no `CRON_TZ`): 06:30
UTC, 01:30 or 02:30 in Toronto. `upgrade.sh` checks readiness from inside the web container. The
`docker-smoke` CI job builds both images, starts the board-hosted install behind Caddy at
`https://localhost`, loads the demo seed, runs the admin CLI, the browser smoke test
(`e2e/smoke.spec.ts`, `@smoke`), a backup and `upgrade.sh`, and proves the schema guard by mounting
one extra migration file into the worker. Found there: inside Compose the database URLs carry
`sslmode=disable` (the internal network has no TLS, and the Supabase CLI refuses a database that is
not local without TLS unless told); Supabase Auth sends an SMTP login only over TLS (or to
localhost), so a board's mail relay needs STARTTLS or no login; and the `supabase/postgres` image
logs the statements of its first start, its own `ALTER USER supabase_admin WITH PASSWORD` included
(our first-start script turns that logging off for its own statements; the journal keeps it 14
days).

**D-115 — Backups: nightly encrypted logical dumps; Supabase's own backups remain the primary path
on hosted; restores are tested in CI (Assumption: RPO 24 h, RTO 4 h, 30 days).**
`deploy/backup/backup.sh` dumps the data of `public` and `auth` (without `auth.schema_migrations`,
`sessions`, `refresh_tokens`, `mfa_amr_claims`, `flow_state`, `one_time_tokens` and
`audit_log_entries`), writes a manifest (release, migration versions, Auth migration versions,
`pg_dump` and server versions, row counts parsed from the dump's COPY blocks), encrypts it with
`age` to `BACKUP_AGE_RECIPIENT` and copies it to S3 `ca-central-1` or the board's storage
(versioning, current objects expire after 30 days, noncurrent after 1 day, a put-only key). Keys
and `.env` are never in backups. `restore.sh` checks the migrations (equal) and Auth migrations (a
superset), refuses a non-empty target without `--force`, loads in one transaction, bans every
deactivated user again, compares counts with the manifest, re-dispatches recent outbox events to
idempotent handlers, and prints the runbook (re-apply access removals made after the backup;
everyone signs in again). On hosted, Supabase's daily backups are the primary restore path, and a
restore of our dump into a staging hosted project is a go-live gate. The monthly drill runs on the
operator's workstation (which holds the private key), never the server.
As built (slice S3b): a backup is `lynx-backup-<UTC time>.tar` holding two files encrypted to the
recipients (several allowed): `dump.sql.gz.age`, streamed from `pg_dump` through the row count and
gzip to age, so the dump is never in clear on disk, and `manifest.json.age` (also the dump's size
and SHA-256), rather than one archive encrypted whole, which would need the clear dump on disk
first. `restore.sh` checks the SHA-256 first; in its one transaction (`session_replication_role =
replica`) it empties every table the backup holds and Auth's sessions, refresh tokens, MFA claims,
flow states and one-time tokens, so no session survives a `--force` restore; the row counts are
checked inside the transaction (a difference rolls everything back). The events handed back are
those dispatched in the hour before the backup of the types `ai.job_requested`,
`absence.sources_changed`, `library_bulk_run.started`, `library_bulk_run.cancel_requested`,
`staff_invitation.created` and `staff.access_changed` (a unit test checks that each of their
handlers is idempotent; `absence.published` is left out, its handler would issue a door credential
once integrations are real). A dump made by `pg_dump` 17 is restored into Postgres 16 (the lite
stack's drill) without its `SET transaction_timeout` header line. The backup records its heartbeat
only on a database that has `app.record_heartbeat`. Tested in CI (`backup-restore`, PostgreSQL 17)
and locally (`tools/lite-stack/stack.sh fresh`, Postgres 16): a deactivated person not yet banned
and two recent events (`deploy/ci/restore-fixture.sql`), a fingerprint (`deploy/backup/fingerprint.sql`),
the backup, an empty database, the restore, the same fingerprint, `RESTORE_SMOKE=1 pnpm test:int
restore-smoke` (the person is banned, only the idempotent event is handed back, a restored teacher
signs in with an e-mailed code) and the pgTAP suite on the restored database.
_Amended in Phase 6 review (2026-10-02):_ backups are signed. `backup.sh` writes a third file,
`signature`: an HMAC-SHA256 with `BACKUP_SIGNING_KEY` (32 random bytes in hex, made by
`generate-secrets.mjs`; computed in bash, so the key is never on a command line) over both encrypted
files' SHA-256. The operator keeps a copy of the key with the age identity, off the server.
`restore.sh` needs it (`--signing-key <file>` or `BACKUP_SIGNING_KEY`) and refuses an unsigned or
altered backup before decrypting anything (the age public key alone lets anyone make an encrypted
file); it then checks that every manifest count is a table of `public` or `auth` with a whole
number, and reads the whole dump before loading it, refusing any line that is not what pg_dump
writes for data (comments, SET, the search path, sequence values, COPY blocks, pg_dump's
`\restrict`/`\unrestrict`): a psql command or another statement never runs on the operator's
machine. The load runs with `--single-transaction` and `ON_ERROR_STOP`.
`deploy/ci/restore-refusals.sh` checks the refusals in the backup CI job.
_Amended in Phase 6 review, round B (2026-10-02):_ `BACKUP_S3_ENDPOINT` sends the copy to any
S3-compatible storage (path-style, the same signature) instead of Amazon S3 only, so a board can
keep it on its own storage; the backup CI job uploads to a stand-in that checks the signature
(`deploy/ci/s3-fake.mjs`). `DEPLOYMENT.md` § 6 gives the restore's route to the database (an SSH
tunnel board-hosted, the workstation's address allowed for the restore hosted) and records the
access once the database is back. The monthly drill is an access: recorded for each board, into a
throw-away copy (a Compose install on an encrypted disk board-hosted, a staging project hosted;
never the lite stack, whose Auth lacks 21 of production's migrations), destroyed afterwards.

**D-116 — Pilot feedback in the app (Assumption on who reads it).** « Commentaires » records a kind
(problem, idea, question), up to 2,000 characters, the route's template, the error reference, the
release, the device class and the locale. The message is checked for students' first names
(`findPersonalInfo`) and each name confirmed, as when sharing. It is stored in Canada; the board
admins of the sender's board read it and mark it « Nouveau », « Lu », « Traité ». At most 20 a
person a day (`LXF01`); kept 365 days (D-105).
As built (slice S1): `submit_feedback` takes the board (one the sender belongs to) and, if given, a
school where the sender works in that board (`42501` otherwise); the 20 count over the last 24
hours; the table's checks refuse a route with a query, and unknown kinds, devices or locales
(`23514`).
As built (slice S4): « Commentaires reçus » (`/board/feedback`, filtered « Nouveau », « Lu »,
« Traité ») shows the sender's name and address only when they agreed to be contacted.
As built (slice S6): « Commentaires » is a button in the top bar (an icon alone on phones) and the
page `/commentaires`; the form keeps a draft per person (D-035). `sendFeedback(input,
confirmedNames)` runs `findPersonalInfo` with the people the sender can see: each student's name is
confirmed (« Envoyer « Samuel » quand même ») and other personal details must be removed before
anything is sent. The server fills the rest: the route template of the page the action was posted
from, the release, the language, and the sender's first school (else board); the browser sends
only the kind of device (by width).
_Amended in Phase 6 review (2026-10-02):_ feedback keeps no student's first name. Before it is
stored, the web server replaces the first names of the students of the sender's schools with «
[élève] » (« [student] » in English) with the AI privacy tools' matching; the roster comes from
`feedback_student_names(text)` (a definer function: office staff, who cannot read students, are
covered; it returns only names whose letters are in the text). Other personal details still block
sending. The dialog says names are replaced; there is nothing to confirm.
_Amended in Phase 6 review, round B (2026-10-02):_ who reads feedback, said the same everywhere: the
people with the « Administration du conseil » role, which IP Lynx may hold during the pilot if the
board asks (`PRIVACY.md` § 2). The terms and the dialog no longer promise that IP Lynx reads every
message: on a board's own servers it reads nothing unless the board shares it.

**D-117 — « Nouveautés » and the version.** `APP_RELEASE` is set when the image is built and shown
in the footer, in `/api/health` and in logs and heartbeats. `/nouveautes` is a static page of
release notes from the message files (`releaseNotes.versions`), checked for French/English parity.
No per-user unread state.
As built (slice S6): the footer of every app page shows « Confidentialité », « Nouveautés » and
« Version … »; `/nouveautes` lists `releaseNotes.versions` in the order of the French file.
_Amended for « Mon année » (2026-10-02):_ `releaseNotes.versions.v070`, « Version 0.7 · Mon
année » (October 2026): « Mon année », planning a unit, « Aujourd'hui » starting a planned unit,
the board's report periods, « Couverture » and « Plan à long terme (PDF) ».
_Amended for « Commentaires de bulletin » (2026-10-03):_ `releaseNotes.versions.v080`, « Version
0.8 · Commentaires de bulletin » (October 2026): the bank in the library, « Créer une banque avec
l'IA », « Bulletins », the reminder on « Aujourd'hui » and the new terms.

**D-118 — Navigation and landing pages (amends D-078).** Two new items: « Direction »
(`/direction`, principals and vice-principals) and « Conseil » (`/board`, board admins). The order
is « Aujourd'hui », « Classes », « Direction », « Suppléances », « Ressources », « Différencier »,
« Calendrier », « École », « Conseil », « Profil ». The phone bar keeps D-078's rules: six places,
« Suppléances » left out first, then the first five and « Plus ». A principal who does not teach
gets six items; a teaching vice-principal « Aujourd'hui », « Classes », « Direction »,
« Ressources », « Calendrier » and « Plus »; a board admin who is not a reviewer three.
`landingFor(session)`: a teacher lands on « Aujourd'hui », the direction on « Direction », office
staff on « Suppléances », a board admin on « Conseil », anyone else on « Calendrier »;
« Aujourd'hui » sends whoever does not teach there instead of to « Calendrier ». As built (slice
S0): `lib/landing.ts` is the pure rule; each landing page admits exactly the people sent to it, so
there is no redirect loop (« Suppléances » needs a school with the Teaching module, as before);
until slices S4 and S5, `/board` and `/direction` are short pages that say the page « arrive
bientôt » and link to what the role already has; the desktop links scroll on their own on a narrow
tablet rather than the page.
As built (slice S4): `/board` is « Administration du conseil »: « Pour bien démarrer le conseil »
(computed: a school year that is not over, every school's office phone, someone besides the board's
admins, a PA day or holiday still to come and, with the Library module, someone who approves
content), « État du système » and « Conservation des données », with the sections as tabs
(« Aperçu », « Personnel », « Écoles », « Années scolaires », « Approbation des ressources » with
the Library module, « Utilisation de l'IA », « Commentaires »); the « Journal d'audit » tab comes
with slice S5. A person who administers several boards picks one (`?board=`, a plain form).
_Amended in Phase 6 review (2026-10-02):_ a principal who does not teach gets five items on the
phone bar: « Suppléances » is left out (her dashboard opens it), because six labels at 360 px
touched each other. « Journal d'audit » highlights « Direction » when the person has it, else «
Conseil ».
_Amended for « Mon année » (2026-10-02):_ « Pour bien démarrer le conseil » has one more item,
« Périodes de bulletin » (D-124); the navigation and the phone bar are unchanged.

**D-119 — Security headers, logs and sessions.** In production, a Content Security Policy
(`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri
'self'; form-action 'self'; object-src 'none'`) and `X-Robots-Tag: noindex, nofollow` on every
page; HSTS (one year) at Caddy. Access logs go through Caddy's `filter` format: the `token_hash`,
`token` and `code` query parameters and the `Cookie` and `Authorization` headers are removed, and
addresses are masked to /24 and /64. Container logs go to journald, kept 14 days. Auth sessions:
a 7-day time box and a 12-hour inactivity timeout (**Assumption**; shared classroom computers).
No personal value in an API query string: lookups by e-mail or name use RPC bodies, because the
hosted gateway's logs record URLs.
As built (slice S3a): the headers come from `apps/web/src/lib/security-headers.ts`; PDF routes
(a last segment `pdf`) carry every header but the policy, because a PDF opened in the browser is a
plugin document that Chrome checks against its own `object-src`. The portal rules (`no-store`,
`no-referrer`) still apply on top. The browser tests run on the production build, so every page
family (app, portal, `/jouer`, projector) is exercised under the policy; `e2e/operations.spec.ts`
also fails on any policy violation the browser reports.
As built (slice S3b): the session limits are in `supabase/config.toml` (`[auth.sessions]`, read by the
Supabase CLI and the lite stack) and `GOTRUE_SESSIONS_*` in `compose.supabase.yml`; hosted, they are
dashboard settings (Pro plan).
As built (slice S7): an ESLint rule (every app and package) refuses a PostgREST filter on `email`,
`first_name`, `display_name` or `honorific`, any pattern or full-text filter, and the same in
`.or()` syntax (`apps/web/src/lib/no-personal-query-strings.test.ts` pins it). The proxy's access
log also drops the `q` parameter (the words searched in « Ressources ») and the `Referer` header.
The CSP check of `e2e/operations.spec.ts` now covers the projector, the public privacy page and the
Phase 6 teacher pages too.
_Amended in Phase 6 review, round B (2026-10-02):_ what reaches the journal, board-hosted. Auth logs
at `warn` (`AUTH_LOG_LEVEL`; at `info` it writes the address of every code request, sign-in and
sign-out). The database runs with `log_statement=none`, `log_error_verbosity=terse` and
`log_min_error_statement=panic`: the image's `log_statement = 'ddl'` wrote role passwords, its own
first-start `ALTER USER supabase_admin WITH PASSWORD` included (the options reach the initializing
server too), and an error's DETAIL and statement quote values (« Key (email)=(…) already exists »).
Checked on the lite stack (the same Auth binary at both levels; PostgreSQL 16 with each setting),
and in the `docker-smoke` CI job, which fails if the install's journal holds an e-mail address or a
password statement. An error's own message can still quote a value (« invalid input syntax for
type uuid: "…" »), and Auth's errors can name an address a mail relay refused: `PRIVACY.md` § 8
says so. The admin CLI's replies name people: its container logs nothing (`driver: none`), so they
reach the operator's terminal only. The journal starts a new file each day (`MaxFileSec=1day`), so
the 14 days hold (a month-long file would outlive them). The 14 days stay: the app's own lines are
scrubbed, the others now hold no addresses in normal use, and incidents need them.

**D-120 — The demo is scripted and tested; a hosted demo site is deferred.** `docs/demo-script.md`
is the script (15 and 5 minutes); `e2e/demo.spec.ts` clicks through it on the lite stack with the
fake AI provider. A public demo site would run on a separate small server with invented data,
never on the pilot server, which holds the pilot's service key and alert keys.
As built (slice S7): `e2e/demo.spec.ts` has one test per step of the script (steps 1 to 10; step 11
is a slide). The absence is for the next school day, so the script's « 6 h » runs at any hour; the
substitute's alert reveal is real, so the « Journal d'audit » step shows the office-issued flag from
the demo itself; the invited teacher goes through « Bienvenue » and makes a sample class; everything
is removed at the end.

**D-121 — Staff sign-in is throttled by the app (Phase 6 review).** Supabase Auth keeps no count of
wrong codes per address, and applies its per-address limits only when it can tell the client's
address. Before every code request and code check, the web server asks `sign_in_attempt(kind, email,
ip)` (the only function `anon` may run): code requests, 5 an hour per address and 30 every 15
minutes per network; code checks, 5 wrong codes per code (then only a new code, or the e-mail's
link, works: « Trop de codes erronés. Demandez un nouveau code, ou ouvrez le lien reçu par courriel.
»), 20 a day per address and 30 every 15 minutes per network (« Trop de tentatives de connexion.
Réessayez dans N minutes… »). A sign-in (code or link) clears the address's attempts
(`sign_in_succeeded`, as the signed-in person). Attempts are stored as HMACs with a random key of
the install (`app.install_secrets`, never in backups), never as addresses, and deleted after two
days. An unknown network (`CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` not set up) gets no shared
bucket: one person's wrong codes must not lock out a whole install. The link in the e-mail is not
throttled (it cannot be guessed). On board-hosted installs Auth's own limits are on as well: Auth
reads the client's address from `X-Lynx-Client-Ip` (`GOTRUE_RATE_LIMIT_HEADER`), which the web
server sets on its sign-in calls; Auth is reachable only from inside, so nobody else can set it
(`AUTH_RATE_LIMIT_OTP`, `AUTH_RATE_LIMIT_VERIFY`: 60 per address per 5 minutes, room for a school's
morning). Hosted Supabase cannot be given the header; there the app's throttle is what counts, and
Supabase's per-address limits apply to the web server's address (docs/phase-6.md, S7).

**D-122 — The end of a contract: the operator exports a board's whole audit log, and a board is
deleted only after such an export (Phase 6 review, round B; amends D-106, D-107).** A board admin's
« Journal d'audit » holds the administrative entries only, a year per file (D-103), and each
principal's only the school's; `delete-board` deletes every entry. `pnpm admin export-audit --board
<slug> --out <file>` writes every entry of the board and its schools, of every audience and date,
oldest first, as one CSV file (UTF-8 with a byte order mark, comma-separated; the school's and the
acting person's names, the details as stored; a typed name that starts like a formula is kept as
text), with mode 0600 and never over an existing file. It reads `operator_export_audit(board,
after_id, limit)` a page at a time (the API returns 1,000 rows at most), then records the export
with `operator_log_audit_export(board, last_id, rows)`, which refuses a count that does not match
the board's entries up to `last_id` (`audit_log.operator_exported {rows, last_id}`, audience
`board`, actor `service`). `operator_delete_board` refuses (`LXB01`) unless such an export was
recorded in the last 7 days, and returns `auditRowsSinceExport` (the entries written after it,
which the file lacks; the CLI prints the number). The file includes the operator-only entries
(teachers' private activity, D-103), so it goes to the board's privacy office, not to its admins,
and IP Lynx deletes its copy once the board has it. _Why:_ the board is responsible for the
records (MFIPPA); deleting them must not depend on someone remembering a download. Tests: pgTAP
`33_board_audit_export`, `apps/admin/src/commands/staff.test.ts`, and the `docker-smoke` CI job
(refused before the export, then the export from the image and the deletion).

**Amendments to existing decisions** (slice S7 wrote each one into its entry, as « Amended in Phase 6 »):

| Decision     | Amendment                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- |
| D-002        | the name is `APP_NAME`, read at run time (D-113)                                              |
| D-004        | a web interface exists for board admins to manage their own board's staff (D-107)             |
| D-012        | the raw audit table is closed to the API; operator functions run with the service role only   |
| D-013, D-036 | the direction's dashboard; board admins' audit scope (D-102, D-103)                           |
| D-017        | catalogue, closed table, guard trigger, viewer, purge (D-103, D-105)                          |
| D-018, D-059 | the retention jobs exist; the class purge keeps planning; bounds of at least 365 days (D-105) |
| D-029        | hosting decided (D-114)                                                                       |
| D-039        | board admins may switch AI (D-108)                                                            |
| D-040        | usage totals in the web, rows the author's only; payment collection still later (D-104)       |
| D-043        | usage records are deleted after `aiUsageDays` (D-105)                                         |
| D-046        | per-person usage is never shown (D-104)                                                       |
| D-055        | sample classes are left out of plans (D-109)                                                  |
| D-056        | the office-issued flag exists; board admins see no substitute audit (D-103)                   |
| D-064        | board admins designate the board's reviewers in « Conseil » (D-107)                           |
| D-078        | navigation (D-118)                                                                            |
| SPEC §5      | deviation: no Vercel (D-114); not amended in `SPEC.md`, which keeps the brief as written      |

**Amended in the Phase 6 review (round A):** D-055 (classes of the plan's year), D-105 (the class
purge keeps to its year; 60 days of notice whatever the dates), D-107 (one connection per job, the
unban retried, inviters who left, deleted accounts' invitations), D-110 (what changed; « Plus tard
»), D-112 (« prévu »), D-115 (signed backups, checked restores), D-116 (no first names in feedback),
D-118 (the direction's phone bar; « Journal d'audit »); new D-121 (the sign-in throttle).

**Amended in the Phase 6 review (round B, the privacy wording):** D-038 (texts state the AI limit),
D-107 (the board's pages name « la personne qui gère le serveur »), D-110 (terms
`2026-10-pilote-2`), D-111 (no `ERROR_REPORTING_DSN`; the journal), D-115 (S3-compatible storage,
the restore's route, the drill), D-116 (who reads feedback), D-119 (what Auth and the database
write to the journal); new D-122 (the whole audit log exported before a board is deleted).

## « Mon année » (post-MVP 1)

Feature #1 after the pilot build: a year planner per class (« Mon année »), curriculum coverage
(« Couverture ») and a long-range plan PDF (« Plan à long terme »), built in three slices: S1 (the
database, the domain code, the board's report periods and planning on the unit page; D-123,
D-124), S2 (the year view and « Aujourd'hui »; D-126) and S3 (coverage and the PDF; D-125, D-127).
The plan's questions were answered by the lead for Mike (2026-10-02), and the slices build on
them: (1) no new curriculum content: coverage counts the summaries already loaded (D-030, D-069);
(2) report card dates are typed by the board's admins, with « Préremplir avec les dates
habituelles » (D-124); (3) a finished unit counts its unit-level attentes as taught, shown as
« Enseignée (unité terminée) » (D-125); (4) coverage is off by default in the PDF (D-127); (5) no
AI for the year plan for now (D-128).

**D-123 — Planned windows and unit-level attentes (amends D-047).** A unit may have a planned
window, both dates or neither (`units.planned_start_on`, `planned_end_on`), inside its class's
school year (`LXY01`, checked when the window is set or changed, so a year edited later never
blocks other changes to the unit). The teacher picks a first and a last week (Monday to Friday,
each labelled with its school days); the window is saved as the Monday of the first and the Friday
of the last, clamped to the school year (**Assumption**: weeks are Monday to Friday). A unit aims
at attentes (`unit_expectations`) of its own subject and of its class's grades (`LXY02`;
**Assumption**: no cross-subject unit in v1), at most 200; a unit with attentes keeps its subject
(`LXY02`). Only the class team reads and writes them, as units (D-013): never the direction,
office staff, the board's admins or anyone whose access was removed. Writes go through
`save_unit_plan` (a unit and its attentes in one transaction; a new unit is `planned`) and
`start_unit` (« Commencer l'unité », optionally finishing the current unit first), both security
invoker, so row level security and the column grants check every row. Planned units never start
by themselves (**Assumption**): the teacher starts them. Substitute plans are unchanged (they read
only active units), and the plan-freshness trigger on `units` (D-047) now fires on an update only
when a column plans read changes (`class_id`, `subject_id`, `title`, `status`): saving a window, a
description or attentes no longer marks the teacher's upcoming absences as changed. Not audited
(private professional activity; D-103 would put it in the operator's audience anyway). Kept with
the class; the student purge keeps it (D-105). _Why:_ a year plan is the teacher's tool; the
attentes give coverage (D-125) without making teachers link every lesson.
As built (slice S1, `20270111090000_year_plan.sql`, pgTAP `34_year_plan`): the unit page shows
« Prévue du … au … » with its weeks and school days, the attentes as chips (their text in a
disclosure) and « Modifier la planification » (`UnitPlanDialog`, `ExpectationPicker`: by grade and
domaine, a filter that ignores accents, an overall attente ticked for all its contenus and shown
partly ticked when only some are chosen, « À vérifier » on unverified rows); the lesson form lists
« Attentes de l'unité » first. The domain module `packages/domain/src/year-plan` has the weeks
(`schoolWeeks`, `weekWindow`, `unitSchoolDays`), the liturgical bands, placement, report periods,
coverage and the planned unit due on « Aujourd'hui », for slices S2 and S3. Actions
`saveUnitPlan` and `loadExpectationOptions` (`server/actions/year-plan.ts`) gate through
`requireSession()` (D-109), as the planning, progress, roster and timetable actions now do too.

**D-124 — Report periods are board data (amends D-107 and D-118).** Each school year has up to
three report periods, Ontario's (`progress`: the Progress Report Card; `term1` and `term2`: the
Provincial Report Card), each an evaluation window inside the year (`LXY03`) and two optional
dates, « saisie au plus tard le » and « remise aux familles », never before the window starts.
Fixed kinds, so nothing to translate; overlapping windows are normal (the progress report's falls
inside the first term's). The board's admins set them in « Années scolaires » (« Périodes de
bulletin »); the board's staff read them; they are not audited (school years are not either), and
a school year edited later is not blocked (the editor shows « Hors de l'année »). « Préremplir avec
les dates habituelles » proposes, without saving (**Assumption**, per board, not per school): the
progress report from the year's first day to October 31, saisie November 7, remise November 15;
the first term to January 31, saisie February 7, remise February 15; the second term from February
1 (the school day on or after it) to June 11, saisie June 16, remise on the year's last day; each
date moved to the board's school day on or before it (2026-2027: the first term's remise moves off
Family Day to February 12), with the note « Dates habituelles proposées : à vérifier avec le
calendrier du conseil. ». « Pour bien démarrer le conseil » gets « Périodes de bulletin » (done
when a school year that is not over has all three). Deleted with their school year or board.
As built (slice S1): `report_periods` (pgTAP 34); `typicalReportPeriods` (`packages/domain`; a unit
test checks it against the demo seed, `supabase/seeds/50_year_plan_demo.sql`); actions
`saveReportPeriods` (the three kinds in one dialog; a kind left blank is removed; a window outside
the year is a field error before the database's check) and `prefillReportPeriods`
(`server/actions/board.ts`); `ReportPeriodsEditor` on each year's card.

**D-125 — Coverage is computed from the class's own data (amends D-013 and D-094).**
« Couverture des attentes » (`/classes/[id]/planning/coverage`), the third section of a class's
« Planification ». For each attente loaded for the class's grades (D-030, D-069), its status, best
first: « Enseignée » (a lesson linked to it was given), « Enseignée (à confirmer) » (a substitute
reported such a lesson and the teacher has not confirmed it, D-054), « Enseignée (unité
terminée) » (a finished unit aims at it, even with no lesson linked: **Assumption**, the lead's
answer to question 3), « Prévue » (a unit that is not archived aims at it, or a lesson linked to it
is still to be given), « Pas encore prévue ». Skipped lessons, archived units and the lessons left
in a finished unit count for nothing. A period narrows it: « Toute l'année », one of the board's
report periods (its evaluation window, D-124) or « Dates choisies »; only the lessons given inside
it and the units whose window overlaps it count, a unit without a window counts for the whole year
only, and an attente given only before the period is « Enseignée avant la période ». Each attente
shows its evidence (« 2 leçons données (dernière le 14 oct.) », the lessons reported, « Unité
« … » (11 janv.–5 févr.) » linking to the unit). The counting unit is D-094's (a specific attente,
or an overall attente without specific ones; an overall attente with specific ones is their
heading, « 2 sur 3 enseignées »), and the counts (« 22 attentes · 9 enseignées · 5 prévues · 8 pas
encore prévues ») do not change with « Afficher » (« Toutes », « Pas encore prévues », « Prévues »,
« Enseignées »). Without a subject, an overview per subject (and per grade in a combined class) for
the whole year; a combined class shows one grade at a time. While an attente is a summary,
« Attentes résumées, à vérifier contre le programme officiel ; la liste peut être incomplète. »;
« Comment on compte » says all of this. Computed on each request under row level security as the
teacher, from the class's units, lessons and progress: nothing is stored and nothing is added to
the database. Private to the class team (the class layout, D-013): never a direction, office, board
or audit view, and no percentages. _Why:_ before report cards a teacher asks what she has taught
this term; the answer must come from her own planning without her linking every lesson (finished
units count), and must never become a way to monitor teachers.
As built (slice S3): the statuses are the domain's `expectationCoverage` (S1);
`server/planning/coverage-view.ts` (pure, unit-tested) reads the address and groups for display;
`server/queries/class-coverage.ts` (`loadCoverageInputs`, `loadClassCoverage`; the curriculum of the
class's grades is read in pages of 1 000 rows, PostgREST's limit); `components/coverage/*`. The
filters are a GET form (they work without JavaScript; the dates appear for « Dates choisies ») and
« Afficher » a row of links. `taughtExpectationIds` stays the report-comment composer's hook.
Browser tests: `year-plan.spec.ts` (the statuses match the seed, a lesson given turns « Prévue »
into « Enseignée », the report periods and chosen dates, « Afficher »), `year-plan-mobile.spec.ts`
(360 px) and the security-policy check.

**D-126 — The year view (« Mon année »).** `/classes/[id]/planning/year`, a section of the
class's « Planification » tab (« Unités · Mon année · Couverture »; « Couverture » is D-125; no
new navigation item, D-118 unchanged). The school year as weeks, Monday to Friday, each labelled by its
first day in the year, grouped by month: a « Calendrier » row (« Pas d'école » and the reason for a
week without school, « 4 jours » and the days off named for a partial week, « Messe » for masses
and liturgies), a « Bulletins » row (each report period's end, « saisie » and « remise », D-124), a
« Temps liturgique » row (Advent, Christmas, Lent and Easter as `liturgicalSeasonOn` computes them,
D-058; a week takes the season of its Wednesday; each band named, never colour alone) and one row
per subject with units or timetable blocks, with a second lane when two units share a week. Each
unit is a button with its title and its status in words (« À venir », « En cours », « Terminée »,
or « Pas encore commencée » for a planned unit whose start has passed) that opens « Planification
de l'unité » (D-123); « Planifier une unité » creates one. A unit under way or finished without
saved dates is dated from its lessons (first to last lesson taught, up to today while under way)
and marked « Dates d'après les leçons »: shown, and saved, as its weeks, only when the teacher taps
« Enregistrer ces dates » or saves the dialog (**Assumption**). Units without dates are listed with
« Placer ». Warnings in words: two units of a subject that overlap, weeks without school inside a
unit, a unit outside the school year. On phones (below `md`), a list of months instead of the grid
(school days, days off, events, report dates, seasons and the units that touch the month), so
nothing scrolls sideways at 360 px. No drag and drop. On « Aujourd'hui », a subject block whose
class and subject have a planned unit due that week (its window starts by the week's Friday and has
not ended; the earliest) says so: with no unit under way, « Aucune unité en cours. « … » est prévue
à partir du … » and « Commencer l'unité »; when the unit under way has all its lessons given,
« Terminer et commencer « … » » (that unit is marked « Terminée » first); with lessons left,
« Prochaine unité prévue : « … » (à partir du …) » and a link to « Mon année ». Never automatic
(D-123). Private to the class team (the class layout, D-013); not audited. _Why:_ teachers plan by
weeks against the calendar they live by (days off, report cards, the liturgical year), and a
grid of some forty weeks does not fit a phone, while a list of months does.
As built (slice S2): `loadYearPlan` (`server/queries/year-plan.ts`) and the pure model
`buildYearView` (`server/planning/year-view.ts`, unit-tested); `components/year-plan/year-grid.tsx`
(a `<table>` with a caption, header scopes and spans, in a focusable box that scrolls sideways and
opens on the current week, the subject column, unit titles and month names kept in view),
`year-month-list.tsx`, `year-plan-lists.tsx` and one planning dialog shared by every unit on the
page (`year-plan-dialogs.tsx`, so the year's weeks are sent once); `PlanningTabs` on the units list,
a unit's page and the year; actions `saveUnitDates` (keeps the unit's title, description and
attentes) and `startPlannedUnit` (`start_unit`), both gated by `requireSession()`; `loadToday`
reads the planned units of the date's week (`plannedUnitFor`). « Nouveautés »: `v070`, « Version 0.7
· Mon année ». Browser tests: `year-plan.spec.ts`, `year-plan-mobile.spec.ts` (360 px), the sample
class's dates in `onboarding.spec.ts`, and the page in the security-policy check.

**D-127 — « Plan à long terme » PDF.** « Plan à long terme (PDF) » on « Mon année »
(`/classes/[id]/planning/year/pdf`): page 1, landscape, the year at a glance (a column per month
with its school days; rows for the calendar's days off and masses, the report dates, the
liturgical seasons and each subject of the year view, with the units that touch the month and their
dates, « † » for dates taken from the lessons and not saved); then, in portrait, the units by
subject in date order with their dates, weeks and school days and the attentes they aim at (code
and text, « à vérifier » while a summary), then the units without dates; and, only when the teacher
ticks « Inclure la couverture des attentes » (`?coverage=1`), « Couverture des attentes »: the whole
year's counts per subject (and grade), as D-125 counts them. Coverage is off by default
(**Assumption**, the lead's answer to question 4): the plan is not a scorecard. The header names
the school, the class, the year, the class team and the day it was printed; the footer the
document and its pages, and « Les attentes « à vérifier » sont des résumés. » when one is printed.
D-053's rules: on demand, never stored, Node runtime, `no-store`, a `/pdf` path, a plain GET form,
`?download=1`, a failure page with a way back. It reads no student data (the year, the units, their
attentes, the class team and, when asked, the class's progress); a unit's description is never
printed and unit titles are printed as typed. Labels follow the reader's language; the curriculum's
text is French. For the class team only (404 for anyone else, as the class pages). Not audited and
sent nowhere: « Ce document est à vous : vous décidez à qui le remettre. » _Why:_ principals ask
for a long-range plan, which teachers otherwise write by hand from the same data.
As built (slice S3): `server/pdf/year-plan-model.ts` (pure; unit tests for the month cells,
« 1er », no coverage unless asked and no student data), `year-plan-document.tsx` (US Letter, Noto
Sans; a date never breaks across lines), `year-plan-labels.ts`, `renderYearPlanPdf` (fonts warmed,
`render.test.ts`), `server/queries/year-plan-pdf.ts` and `YearPlanPdfForm` beside « Planifier une
unité ». The year view's model (`buildYearView`) places the units, so screen and paper agree.
Browser test: `year-plan.spec.ts` (`%PDF`, `private, no-store`, no page policy, one more page with
coverage, 404 for another teacher's class).

**D-128 — AI for the year plan is deferred.** « Proposer une répartition (IA) » is not built:
production boards have no curriculum loaded (D-030), the demo sample is partial and unverified,
and the report-comment composer's January deadline comes first (lead's answer, 2026-10-02). When
it is built (Mike's yes, real curriculum loaded): a `year_plan` feature whose input the database
builds from ids (grades, subject, attente codes and texts, school weeks, seasons, report periods,
the existing units' windows and attentes, never their titles), an optional « Précisions » field
through the redaction and the outbound check with the exact text shown before sending, output
validated (codes from the input, weeks inside the year, no overlap per subject; unused attentes a
warning, not a paid retry, D-080), never applied automatically, from the school's budget (D-040).

## « Commentaires de bulletin » (post-MVP 2)

Feature #2 after the pilot build: comment banks for the report card in the library (« Banque de
commentaires de bulletin »), AI that writes such banks from curriculum labels only, and a composer
per class and report period that runs in the teacher's browser (« Bulletins »). Built in three
slices: S1 (the bank as library type 26; D-129, D-131), S2 (« Créer une banque avec l'IA »; D-132)
and S3 (the composer, the terms and « Aujourd'hui »; D-130, D-133 to D-135). The lead answered the
plan's questions for Mike (2026-10-02), and the slices build on them: (1) no AI on an individual
student's comment; (2) comments stay on the device; (3) 1,000 characters by default and plain
spaces on copy, both adjustable; (4) the AI may write general banks when no attentes are loaded,
marked as drafts to read; (5) the composer's drafts are erased when another account signs in on
the browser and 60 days after the report goes home (for the lawyer). The feature is never called
« Commentaires » alone: that word is the feedback button (D-116).

**D-129 — Comment banks are library type 26, `report_comments` (amends D-061, D-067, D-071, D-076,
D-077, D-082, D-094 and D-100).** A bank is library content like any other: the board's or a teacher's, shared
with the first-name check (D-066), approved, faith-reviewed when it is about Enseignement religieux
(D-064), found by search (« bulletin », « points forts », « prochaines étapes », « habiletés
d'apprentissage »), adapted (D-092) and carried in content packs. Its content (schema version 1)
says what it is for (`scope`: a subject, the learning skills and work habits, or religion) and for
which report (`period`: « Bulletin de progrès », « Bulletin scolaire » or both), then holds 1 to 160
entries: a kind (« Point fort », « Prochaine étape », « Commentaire général »), the mark it is for
(an achievement level 1 to 4 for the report card, a progress mark « Progresse avec difficulté /
bien / très bien » for the progress report, a learning skill and its rating E, T, S or N; none:
for every mark), an optional achievement-chart category, up to four attente codes, and a neutral
text of at most 400 characters with optional feminine and masculine texts. In `final` mode a
skill is set exactly for learning skills, a level only for a report card, a progress mark only for
a progress report, a rating only with a skill; no token other than `{prénom}` between braces
(`placeholder`) and no curriculum code in a text (`codeInText`). « Évaluer », for teachers only
(no student sheet), one base version and no levels. It is not teaching material
(`TYPE_INFO.teachingMaterial: false`): no duration, materials or formats (printable only), never
in a lesson (`LXK01`), class mode, the projector or a substitute plan (constraints and the lessons
trigger); a bank prints and downloads as a PDF through the library's routes, since it holds no
student data. The subject is optional only for a learning-skills bank, and attentes are optional
for every bank (production boards have no curriculum, D-030: a bank without attentes holds
« commentaires généraux » for its subject). The editor shows the entries grouped by attente (or
learning skill), then by kind, each with its mark, category, attente codes and texts; the item
page's teacher document groups them the same way. « Créer avec l'IA » and bulk generation refuse
the type (22023; banks have their own request, D-132, and are not generated in bulk,
**Assumption**). The database checks the metadata (`app.library_assert_ready`); the app checks the
scope against the subject (`reviewReadiness`, D-067). The demo pack has three banks (D-071).
_Why:_ teachers already keep comment banks; as library content they get review, sharing and
approval for free, and a 26th type costs less than a new store. As built (slice S1): migrations
`20270118090000_report_comments_type.sql` (the enum value) and
`20270118090100_report_comments.sql`; pgTAP `35_report_comments`; `@lynx/content`
`types/report-comments.ts` and `report-comments.ts`; the editor's `CommentEntriesEditor`. A bank
never counts in « Couverture du curriculum » (D-094): it is not a resource for teaching an attente.

**D-130 — Comments are composed on the device only (amends D-044).** « Bulletins »
(`/classes/[id]/bulletins`, D-135) composes report card comments in the teacher's browser. There is
no table for them, no server action, no route handler, no form that carries them and no PDF (a
server-rendered PDF would send the text to the server; « Imprimer » is the browser's own, one
student per page). The server gives only what « Élèves » already shows (the students' first names)
and data that is not about a student: the report periods, the subjects, the usable comment banks
(`search_library`, then the chosen bank's base version and `content_revision`) and the attentes
taught during the period (`taughtExpectationIds` over the class's own units, lessons and progress,
D-125). The device draft (`lynx-draft:report:{userId}:{classId}:{periodKey}`, `reportDraftSchema`,
version 1) holds per student id, never per name: the wording (neutral, feminine or masculine), the
grade in a combined class, « Mes notes », and per subject the mark (an achievement level, a
progress mark or a rating per learning skill), the chosen entries (bank id, revision and index;
entries of an older revision are dropped and the text stays) and the comment, in template form:
the student's first name is written `{prénom}` (`unfillComment`) and put back only to show, copy
and print it (`fillComment`, D-131), so `localStorage` never holds a first name. The period key is
the board period's kind (one per school year, and a class has one year) or the chosen dates and
report. Drafts are removed at sign-out (`clearAllDrafts`, after which this page writes nothing
more), by « Effacer le commentaire » and « Effacer mes commentaires de cette période sur cet
appareil », when another account signs in on that browser (`forgetReportDrafts`, the janitor in
the signed-in shell, which also removes expired and unreadable report drafts), and at the latest
60 days after the « remise » (`draftExpiresOn`: the « remise », else the « saisie », else the
period's last day, plus 60 days; **Assumption**; an expired period's page keeps nothing). Unlike
other drafts, a write that fails (a full device) is said in words (« L'espace de cet appareil est
plein : copiez vos commentaires maintenant. »), and another tab's changes are taken up (« Modifié
dans un autre onglet »). The comment's limit is a setting per class and period on the device, 1,000
characters by default, 100 to 5,000, with « Espaces simples à la copie » on by default
(**Assumptions**; Q3). The learning skills come first for the homeroom teacher (**Assumption**).
The proposals are rules, not AI: a bank's entries for the student's mark, those tied to an attente
taught during the period first (D-069's rule through overall and specific attentes), then those
about no attente, in the bank's order; entries for attentes not taught are folded away; with no
attente loaded, or none taught, every entry is offered and the page says so; entries sharing a
word with « Mes notes » come first (« D'après vos notes »). A text edited by hand is never replaced
without asking (« Remplacer votre texte par les entrées choisies? »). _Why:_ the product owner's
rule (Q2: comments stay on the device), the boards' report card system is the record, and an
evaluative text about a child is personal information even without the name; a template on the
device also keeps identity out of any future AI step by construction (D-133). As built (slice S3):
`packages/domain/src/report-comments/` (periods, subjects, suggestions, the draft),
`hooks/use-report-draft.ts`, `hooks/draft-storage.ts` (`forgetReportDrafts`),
`components/report-comments/`, `server/queries/report-comments.ts`; a unit test checks that the
composer's files import no server action or `server-only` module and make no request, and the
browser test types a sentinel in every field and finds it in no request.

**D-131 — The `{prénom}` placeholder and elision.** Bank texts name the student only as
`{prénom}`; the app never stores a student's name in a bank. Filling it in (`fillComment`) elides
« de », « que », « lorsque » and « puisque » before a first name that calls for it, with the
typographic apostrophe and a capital kept at a sentence start (« D’Aïcha »): before a vowel,
accented or not, before H (taken as mute: « d’Hugo », **Assumption**) and before Y followed by a
consonant (« d’Yves »), but not before Y followed by a vowel (« de Youssef »); an elided article
written in a template comes back in full before a name that does not elide (« d’{prénom} » →
« de Samuel »). The way back (`unfillComment`) replaces the first name written with its capital as
a whole word, so a stored comment holds the template and `fillComment` gives back the same text
(a wrong elision typed by hand is corrected). Neutral (épicène) wording comes first; the feminine
and masculine texts are optional, for when agreement cannot be avoided; the wording is chosen per
student on the device, and the app never infers gender from a name. A comment's length counts
Unicode code points after NFC, a line break as one (**Assumption**); no-break spaces can become
plain spaces on copy. Qualifiers: an entry for one achievement level must not carry another
level's qualifier (`entryQualifierProblems`, a readiness warning). Banks use the achievement
chart's scale, the same one as rubrics and the `library_item/v1` prompt (one source of truth:
`REPORT_CARD_QUALIFIERS` is `ACHIEVEMENT_QUALIFIERS`, and detection is the rubric's
`qualifierLevels`): for the knowledge category « limitée », « partielle », « générale »,
« approfondie » (levels 1 to 4), and for the three others « avec une efficacité limitée », « avec
une certaine efficacité », « avec efficacité », « avec beaucoup d'efficacité ». « Une bonne
compréhension / connaissance » is still read as level 3 when a bank is checked (teachers write
it), but the demo banks and the AI write « générale ». Both scales are **à vérifier** against the
official achievement chart (D-030): the lead confirmed the effectiveness scale from a summary of
the Faire croître le succès chart only. _As built (slice S2):_ the open question of S1 (a second,
report-card scale with « avec un très haut degré d'efficacité ») is closed by this alignment; the
demo bank « Mathématiques, 3e année » was reworded to match. _Why:_ the name must never reach a bank, and a composer that stores templates keeps first
names off the device's storage too (D-130).

**D-132 — « Créer une banque avec l'IA » is its own feature (amends D-072 and D-080).** A teacher
or a member of the direction at a library school with AI on asks for a comment bank at
`/library/generate/comments` (also linked from the library hub, « Créer une banque de commentaires
(IA) », and from « Créer avec l'IA »). The form sends ids and choices only: the scope (a subject,
the learning skills and work habits, or Enseignement religieux), the report (« Bulletin de
progrès » or « Bulletin scolaire », one at a time; a bank for both is written by hand), one grade
from 1re to 8e année (**Assumption**), the subject (none for the learning skills, Enseignement
religieux for religion and never for a subject), 0 to 12 attentes of that subject and grade (none:
« commentaires généraux », D-030), the length of the entries (250 or 400 characters) and a note of
at most 500 characters. The database builds the input from the ids
(`app.report_comment_bank_ai_input`: labels, attente codes, texts, kinds and domaines from its
tables; 42501 for who may ask, 22023 for anything else) and `report_comment_bank_ai_preview`
returns it, so « Vérifier avant d'envoyer » shows exactly what is sent, names highlighted, under
« Aucun renseignement sur vos élèves n'est envoyé : seulement l'année, la matière et les attentes
choisies. » `request_report_comment_bank` queues it through `app.enqueue_ai_job` (school switch,
school budget, limits per person: LXA01 to LXA03); a second tap with the same input while it is
open returns that job. Nothing about a student, class or school, and no id, is sent; the note is
de-identified and checked like any text (D-038). The feature `report_comment_bank` (prompt
`report_comment_bank/v1`, its common part plus the scope's section and, for a subject or
religion, the report's) answers entries with an attente key (`E1`…) that normalizing turns into
the code; validation retries any token but `{prénom}`, any marker, a code in a text, another
level's qualifier, a text over the chosen length, more than 160 entries and an attente (or the
subject without attentes) without a point fort and a prochaine étape for every level or mark (every
learning skill for the learning skills). The worker needs no code of its own: a trigger on
`ai_jobs` turns a success into the requester's private `ai_generated` draft through the library's
`app.library_item_from_ai_result` (now keeping a missing duration null), with the request's grade,
subject and attentes, the bank's scope and report and the canonical entries, printable only, faith
content for religion (and so the faith review), and audits `library_item.generated`; an unusable
answer fails the job (`invalidOutput`). « En préparation » and the job page are the library's,
in the bank's words; a failed request is taken up again from `?resume=`. The form also takes a link
with ids only (`?scope=&grade=&subject=&period=&exp=`), for « Bulletins » (slice S3). Not
generated in bulk (D-129). Cost: about $0.30 to $0.60 a bank, from the school's budget (D-040).
_Why:_ the input and output of a bank share nothing with a resource's (no duration, materials,
levels, formats or characters), `library_item/v1` is frozen (D-041) and a second section there
would mean re-running its evaluation for 25 types; and a bank written from curriculum labels only
can never hold anything about a student. As built (slice S2): migration
`20270118090200_report_comments_ai.sql`; `@lynx/ai` `features/report-comment-bank.ts`, ten
evaluation cases and `checkReportCommentBank` (`pnpm ai:eval --feature report_comment_bank`);
`server/actions/report-bank-ai.ts`; pgTAP `35_report_comments` (S2 part); e2e
`report-comments.spec.ts`.

**D-133 — No AI on an individual student's comment.** No AI feature reads a report card comment,
a student's mark or « Mes notes »: the AI only writes banks from curriculum labels (D-132). A
« Reformuler ce commentaire (IA) » is designed (`report-comments-plan` S4: only the template form
with `{prénom}` would leave the device, the worker's de-identification and last check on top, a
one-day job deleted as soon as it is read, a board opt-in and the school's AI switch) and not
built. It waits for Mike's yes, a board's written approval, the lawyer's review and new terms.
_Why:_ the product owner's rule (Q1), the boards' AI rules, and an evaluative text about one child
is personal information even without the name.

**D-134 — Pilot terms `2026-10-pilote-3` (amends D-110).** The notice and the terms change meaning,
so the version changes (`CURRENT_TERMS_VERSION`, `TERMS_CHANGES['2026-10-pilote-3'] = 'pilote3'`):
« Ce que l'application recueille » adds that the report card comments a teacher writes stay in her
device's browser and never reach our servers or the AI; « À quoi servent ces renseignements » adds
« les commentaires de bulletin »; « Combien de temps » says they are erased from the device at
sign-out, when someone else signs in on that browser, or at the latest 60 days after the « remise »;
the term « personal » allows, besides alerts, « les commentaires de bulletin, qui restent sur votre
appareil »; the term « account » says signing out erases the drafts and the report card comments.
« Bienvenue » gains the point « Les commentaires de bulletin que vous rédigez restent dans le
navigateur de votre appareil… » and « Ce qui a changé » (`welcome.changes.pilote3`). The seed's
demo accounts accept the new version, so demos and browser tests go straight in; everyone else sees
the banner (D-109). These are the only edits to existing message values in this feature.

**D-135 — The « Bulletins » tab and the « Aujourd'hui » reminder.** « Bulletins » is a class tab
after « Planification » and « Mode classe », for the class's homeroom and subject teachers at a
school with the Library module (**Assumption**); « Soutien » members and everyone else get « Page
introuvable ». No navigation item (D-118 unchanged). Its address holds filters only (`period`,
`from`, `to`, `kind`, `subject`, `bank`; a GET form), and the student shown is the address's
fragment (`#eleve-<id>`), which never leaves the browser: on a phone the list and the student are
two screens and Back returns to the list. « Période » lists the board's periods with their dates
and « saisie » (by default the first whose « saisie » has not passed), and « Dates choisies » with
« Du », « Au » and « Type de bulletin », the only choice when the board has set no period;
« Matière » lists the teacher's own subjects (her timetable blocks, or the blocks without a teacher
for the homeroom teacher, D-006), the learning skills (first for the homeroom teacher), then the
class's other subjects; « Banque » lists the usable banks of the subject's scope (Enseignement
religieux is « L'enseignement religieux ») that serve the report (« Les deux » serves both), the
board's approved ones first, with « Approuvée par le conseil » or « Brouillon — à relire » and
« Voir la banque »; without one, « Créer une banque avec l'IA » (prefilled with ids only: the scope,
the grade, the subject, the report and up to 12 attentes taught; only where the school's AI is on)
and « Créer une banque ». On « Aujourd'hui », from 21 days before a period's « saisie » (or its last
day without one) until that day, each of the teacher's classes as homeroom or subject teacher at a
library school, never a sample class, gets « Préparer mes commentaires » for that period
(**Assumption** on the 21 days). _Why:_ the comments belong to the class and its report period; the
class team already sees the class's students; a reminder three weeks ahead fits the « saisie ».
As built (slice S3): `app/(app)/classes/[classId]/bulletins/`, `ClassTabs`' `bulletins`,
`server/report-comments/view-model.ts`, `components/today/report-reminder.tsx`,
`loadReportReminders`; e2e `report-comments.spec.ts` and `report-comments-mobile.spec.ts` (360 px).

## « Info-parents » (post-MVP 3)

Feature #3 after the pilot build: a weekly message from a class to its families, in French and in
English, drafted by the app from the class's own data, edited by the class team, then copied (or,
from slice S2, printed) by the teacher into the board's own channels. The app sends nothing to
families, stores no parent data and has no parent accounts. Built in three slices: S1 (the data,
the draft, the editor, copying; D-136 to D-138, D-140), S2 (the PDF and the « Aujourd'hui »
reminder; D-141, D-142) and S3 (« Traduire en anglais (IA) », the terms and the docs; D-139,
D-143). The lead answered the plan's questions for Mike (2026-10-03), and the slices build on
them: (1) the app sends nothing: copy or print only, no parent data, no parent accounts; (2)
« Traduire en anglais (IA) » in v1, with stricter rules than D-038 (a paragraph naming « M. » or
« Mme » someone the app does not know is never sent; capitalized words are shown to check; off
wherever AI is off; the preview shows exactly what is sent); (3) no « Améliorer le texte (IA) »
in v1, a typography fix without AI instead; (4) other languages after the pilot; (5) messages are
kept with the students' first names (a year after the school year) and deletable at any time; (6)
« Moment de foi » included by default, one click removes it.

**D-136 — Info-parents: one message per class and week, the class team's; the app sends nothing
(amends D-013, D-033 and D-036).** A class has at most one message per week
(`class_newsletters`, `week_of` a Monday of the class's school year), read and written by the class
team with a teacher role at the class's school (row level security through `app.my_class_ids()`:
never the direction, the office, the board's admins, a removed member or a deactivated account;
the tab « Info-parents » after « Bulletins »). `/classes/[id]/info-parents` lists them, newest week
first (« Brouillon · modifié le 8 oct. par Mme Tremblay », « Envoyé le 9 oct. »), and offers
« Préparer la semaine du … » for this week and the next (this week's Monday from the school's date;
on a weekend, the week that ends) when they have none; `/classes/[id]/info-parents/[weekOf]`
prepares a week (« Préparer le message ») or edits it. The first draft is built from the class's
own data, without AI (D-137). Nothing is sent: « Copier le français », « Copy the English » and
« Copier les deux » put plain text on the browser's clipboard (the header, the sections with their
headings, the signature; French first), and « Marquer comme envoyé » only records that the teacher
sent it (`status`, `sent_at`). No parent data, no parent account, no e-mail or text message, no
read receipt (SPEC §12 « Parents » stays Vision). The family-facing sentences come from both
catalogues whatever the interface's language (`newsletterText` in `fr-CA.json` and `en-CA.json`).
No event and no audit: drafting a message is a teacher's private professional activity (D-024,
D-103). _Why:_ teachers already write this message every week by hand; the class's planning and
calendar hold most of it; and sending would need parent contact data, the Parents module and a
privacy review (Q1). As built (slice S1): migration `20270125090000_class_newsletters.sql`; pgTAP
`36_class_newsletters`; `packages/domain/src/newsletter/`; `server/queries/newsletters.ts`,
`server/actions/newsletters.ts`, `server/newsletter/`; `components/info-parents/`; e2e
`info-parents.spec.ts` and `info-parents-mobile.spec.ts`.

**D-137 — The content of a message.** `content` is `{v: 1, signature, sections}`: the eight sections
in a fixed order (`message`, `thisWeek` « Cette semaine en classe », `nextWeek` « La semaine
prochaine », `dates` « Dates à retenir », `reminders` « Rappels », `atHome` « Pour aider à la
maison », `faith` « Moment de foi », `closing`), each with `off` (« Retirer la section »: kept,
not copied) and at most 12 paragraphs, at most 60 in all. A paragraph has an id (eight lowercase
letters or digits), its French (1,000 characters) and English (1,500), `enFrom` (the French its
English was written from), `enBy` (`app`, `teacher` or `ai`) and `from` (one of the app's lines,
with the id it came from, or `typed`). So the English of each paragraph says where it stands, in
words: « à écrire », « préparé par l'application », « traduit par l'IA — à relire » (slice S3),
« à mettre à jour (le français a changé) » or « écrit par vous » (a French that differs only by
spaces or apostrophes is the same French). The header (the school, the class, « Semaine du 5
octobre 2026 ») is rendered, never stored; the signature (« Mme Tremblay », the creator's
`formalStaffName` by default, **Assumption**, at most 120 characters) is kept apart from the
paragraphs. The app checks the content (`newsletterContentSchema`, at most 60,000 bytes); the
database checks its kind and size (64 KB, as D-048), sets the revision, the status's date and who
wrote it, and a save is an update on the expected `revision` (zero rows: « Une ou un collègue a
modifié ce message entre-temps », the device draft is kept and offered after a reload, D-035). The
first draft (`newsletterFacts`, then `buildNewsletterDraft`) holds, in both languages: the greeting;
this week's lessons per subject and unit (taught or reported by a substitute this week, never
skipped, then those the timetable still gives until Friday); next week's (the timetable's slots
from the preparation date, so the sequence carries on across days off; on a cycle school without an
anchor, the next three lessons of each unit, « prochaines leçons »); a planned unit starting next
week (« Mon année », D-126); the dates from the day after the preparation (or the week's Monday,
for a week to come) to the Friday two weeks later (**Assumption**): days off, early dismissals and
late starts with their times, masses, liturgies, assemblies and field trips (never `other`, never
another class's event), a report card going home (« remise ») and a liturgical season starting; at
most two family guides of the library (`parent_guide`, the ones a lesson of these units uses, then
those about one of their attentes by D-069's rule; the board's approved first) with three of their
« À la maison » tips each, the English tip beside its French one (**Assumption**); a faith moment
(D-058's ranking for the class's grades, the week's season and the week's subjects, lessons and
event titles; the reference's English when it has one); and the closing. Only the teacher's own
subjects by default (her blocks, or the blocks without a teacher for the homeroom teacher, D-006;
« Inclure les matières enseignées par mes collègues » adds the others); the faith moment and the
tips are on by default (**Assumptions**; tips only with the Library module). Titles the staff
typed are quoted as typed, with the app's typography (typographic apostrophes, French spacing).
Never an event's notes (staff-facing), an attente, the coverage (D-125), a level, an alert or
anything about a student. « Préremplir à nouveau » replaces the app's paragraphs from today's data
and keeps the typed ones in their place, the signature and the removed sections (`mergeRefill`).
_Why:_ per-paragraph English provenance shows exactly what is out of date after a French edit,
without a translation table, and a fixed set of sections keeps the copy readable. The seed's demo
Catholic references have an English text of our own, so the demo shows an English faith moment.

**D-138 — Names and retention (amends D-105).** Before a message is copied or marked sent, « Des
élèves sont nommés » lists the class's students it names (« Ce message nomme Samuel et Aïcha. Il
ira à toutes les familles de la classe. ») and the personal details it holds (« Ce message contient
un numéro de téléphone (613-555-1234) : vérifiez qu'il peut être partagé avec toutes les
familles. »), with the AI privacy tools (`findPersonalInfo` with the class roster, students only,
and `findBlockedDetails`), as the library's first-name guard (D-066) does; before the English is
copied, it says how many paragraphs will appear in French. It blocks nothing and nothing about it
is stored; the editor's notice says, always: « Ce message ira à toutes les familles de la classe.
Ne nommez un élève que pour une nouvelle à partager avec tout le monde ; jamais un comportement, la
santé ou une évaluation. » Copying and marking sent wait for a save. Messages are erased with the
students' first names: `app.purge_class_students` also deletes the class's messages (the audit
entry counts them, `newsletters`, when there were some), and a class whose students were purged
takes no new message (`LXN02`), so nothing comes back after a purge; a message also goes with its
class (and a sample class), its board, or « Supprimer » at any time (Q5). The editor's device draft
(`lynx-draft:newsletter:{userId}:{id}`) is a crash backup only (D-035, D-044): it goes at sign-out,
and the janitor of the signed-in shell (D-130) removes another account's when someone else opens
the app on that browser. _Why:_ a message to every family may name a child for good news, never
for anything personal, and the teacher is the last check; the messages are about the class's
students and go when their names go.

**D-140 — No AI rewriting in v1: « Corriger la typographie ».** « Améliorer le texte (IA) » is not
built: rewriting the teacher's French would send more text out and risk invented facts for little
gain (Q3). « Corriger la typographie » fixes the French of every paragraph without changing words,
as the app's own messages are written (`frenchTypography`: typographic apostrophes, « 3e », no-break
spaces inside « » and before the colon, a narrow one before the semicolon, none before ? and !), keeps
an English version written for the French up to date, and lists the words to change by hand
(« week-end », `notCanadianWords`). Nothing is saved until the teacher saves. _Why:_ the families
read the message as written; typography is mechanical, wording is the teacher's.

D-139 (« Traduire en anglais (IA) »), D-141 (the PDF), D-142 (the « Aujourd'hui » reminder) and
D-143 (the pilot terms) come with slices S2 and S3.

## Schema additions beyond SPEC section 8

`school_years`, `rooms`, `class_grades`, `school_cycle_anchors`, `unit_lesson_expectations`,
`library_item_grades`, `library_item_answer_keys` (answer keys in their own table so student-facing
code never reads them), `sub_sessions`, `class_session_results`, `strands` shared across grades,
`lesson_progress.taught_on` / `source` / `pending_confirmation`, `timetable_blocks.day_key` (instead
of weekday), `kind`, `teacher_id`, `room_id`, `notes`, and `unit_lessons.sub_notes`. Phase 3 adds
`sub_plan_classes`, `sub_code_attempts`, `class_sub_profiles`, the plan layers and versions on
`sub_plans`, and `lesson_progress.sub_report_id`. Phase 4 adds `library_reviewers`, and on
`library_items` the review state (`content_revision`, request, approval, faith review, reviewer's
note), the faith flags, the Catholic reference, keywords and the search document. Phase 5 adds
`class_mode_links`, `class_session_keys` and `class_join_failures`; on `class_sessions` the
session's options, phase, question snapshot and version; on `session_participants` the device
number, token hash and last seen; on `session_responses` the question index and score;
`library_bulk_runs` and `library_bulk_requests`; `content_pack_imports`,
`content_pack_import_items` and `content_pack_removed_items`; on `content_packs` the file
fingerprint, licence and report; on `library_items` `board_owned`, `parent_title`, the sharing
cap, `no_derivatives`, `bulk_run_id` and the pack columns (`pack_slug`, `pack_item_key`,
`pack_content_hash`, `pack_revision`); and `library_item_ratings.updated_at`. Phase 6 adds
`staff_invitations`, `feedback`, `audit_action_catalog` and `system_heartbeats`; on `users` the
terms' version and acceptance and the checklist's dismissal; on `classes` `sample_owner_id` and
`students_purged_at`. « Mon année » adds `report_periods` and `unit_expectations`, and on `units`
the planned window (`planned_start_on`, `planned_end_on`). « Commentaires de bulletin » adds no
table, only the `library_item_type` value `report_comments` (D-129). « Info-parents » adds
`class_newsletters` (D-136, D-137).
