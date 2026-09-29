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
are tested (`supabase/tests/00_schema_invariants.test.sql`). _Amended in Phase 3:_ one more
way in, for substitutes only: a private schema run by a dedicated database role that the API
can never become (D-049). _Amended in Phase 4:_ library content is written only through
database functions (D-063).

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
library drafts; office staff have no library screens (D-065, D-078).

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

**D-018 — Proposed retention defaults (implemented as purge jobs in Phase 6).**

| Data                            | Retention                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| A class and everything in it    | Until the teacher deletes it (immediate, cascading), or end of school year + 1 year (proposed) |
| Audit log                       | 2 years                                                                                        |
| Dispatched outbox events        | 90 days                                                                                        |
| Class-mode responses            | Deleted when the session ends (unless the teacher keeps aggregate results, then 1 year)        |
| Substitute codes and sessions   | Expire the same day; deleted after 30 days (implemented, D-059)                                |
| AI usage ledger (metadata only) | 2 years                                                                                        |

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

**D-034 — Phone-first, accessible.** Tap targets are at least 44 px, bottom navigation on phones,
native pickers for dates, times and selects. Target: WCAG 2.0 AA (Ontario's AODA). The end-to-end
tests run axe on key pages and fail on serious violations.

**D-035 — Never lose a teacher's work.** Long text forms (lessons, pasted rosters) autosave a draft
to the device while typing and restore it after a crash or lost connection. Server errors keep the
form as typed. Checking off a lesson is optimistic with an "Annuler" undo.

**D-036 — Class pages are for the class's teaching team.** Principals and office staff don't get
the teacher screens; their oversight views come in Phase 6.

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
through the API.

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

**D-039 — AI is off until the direction turns it on, and a board can forbid it.** Per-school
switch on the École page (principal or vice-principal, audited). `boards.settings.ai.allowed =
false` turns AI off for every school of a board, whatever its principals chose.

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
validating, and send only its section of a prompt (D-080).

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

**D-044 — Drafts are kept per person and survive a failed AI request (amends D-035).** Long text
forms (lessons, pasted rosters, AI requests and results) save a draft on the device once the
teacher edits them, never a copy of what was merely opened. Drafts are keyed by user, so another
account on a shared computer never sees them, and signing out removes every draft from the
device. A draft edited from an older saved version is offered, not restored over newer content.
The text of an AI request is kept until the request succeeds, and a failed request offers
« Reprendre ce texte ».

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
(SPEC §6, content approvals); direct writes would go around them.

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
usable item). _Why:_ reviewers see what they are asked to review and nothing else.

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
`.removed` (both flags). Notes, titles and names are never audited.

**D-080 — AI output quality without paid retries for form (amends D-041).** A feature may choose
its output schema from its input, normalize the answer before it is validated, and keep only the
common part of its prompt plus the section for the requested type. Normalizing converts the `ai`
shape to canonical content and fixes typography in French strings only (`'` between letters
becomes `’`, spaces inside « », a non-breaking space before `:`, « 3ème » becomes « 3e »,
« 1ère » « 1re »), scrambles ordering questions left in answer order and sets `faithContent` when
faith words appear. Substantive problems are still retried: missing keys, the wrong set of
levels, a level name shown to students, person markers, `NOT_CANADIAN` words, « CP/CE/CM »,
invented dotted attente codes, quotations over 40 words and third-party sources.

**D-081 — Hooks for Phase 5 only.** `questions` on games (quiz battles), `studentContent`,
`gradeAll`, the content pack provenance and seed pack format (future export and import), and
`usage_count` with `library_expectation_counts` (the future coverage report). Class mode, trying a
resource as the students, remix, ratings, bulk generation, the coverage page, pack export and
import, images and math drawings, e-mail notifications, a board admin screen for reviewers and
tags, kindergarten content, keys in substitute plans and CSV import are not in Phase 4;
`ai_generations.batch_id` stays unused.

## Schema additions beyond SPEC section 8

`school_years`, `rooms`, `class_grades`, `school_cycle_anchors`, `unit_lesson_expectations`,
`library_item_grades`, `library_item_answer_keys` (answer keys in their own table so student-facing
code never reads them), `sub_sessions`, `class_session_results`, `strands` shared across grades,
`lesson_progress.taught_on` / `source` / `pending_confirmation`, `timetable_blocks.day_key` (instead
of weekday), `kind`, `teacher_id`, `room_id`, `notes`, and `unit_lessons.sub_notes`. Phase 3 adds
`sub_plan_classes`, `sub_code_attempts`, `class_sub_profiles`, the plan layers and versions on
`sub_plans`, and `lesson_progress.sub_report_id`. Phase 4 adds `library_reviewers`, and on
`library_items` the review state (`content_revision`, request, approval, faith review, reviewer's
note), the faith flags, the Catholic reference, keywords and the search document.
