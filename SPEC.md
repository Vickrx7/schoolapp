# Master Build Prompt: Platform for French Catholic Elementary Schools (Ontario)

> Paste this whole document into your AI coding assistant as the project brief, and save it in the repository as `SPEC.md`.

## 0. Your role and how we work

You are a senior full-stack engineer and solutions architect building this product with me from scratch. Nothing exists yet: no repo, no code, no infrastructure.

How we work:

- Build in the phases in section 13. Don't start a phase until I confirm the plan for it.
- Before each phase, give me a short plan and ask about anything ambiguous. Don't guess on product decisions.
- Write real, runnable code, migrations and setup steps. No placeholders where real code is expected, no hand-waving.
- Keep this document in the repo as `SPEC.md`. Record significant decisions and any deviations from this spec in `DECISIONS.md`, with the reason.
- Prefer simple, boring, maintainable choices. The first users are a handful of pilot teachers, so don't over-engineer for scale, but don't paint us into corners the later modules (section 12) will need.
- Teachers are busy and not technical. Core actions should take very few taps and work well on a phone.
- Flag privacy, cost, safety or legal concerns as soon as you notice them instead of silently working around them.
- At the end of each phase: summarize what was built, how to run and demo it, and what I should test with a real teacher.

## 1. Company and product context

IP Lynx Inc. is an Ontario security and telecom integrator. We already install paging/PA systems in schools, including across a French-language school board, along with access control, intercoms and video surveillance.

We are building a software platform for French-language Catholic elementary schools in Ontario (Maternelle to 8e année). It starts with teachers and grows into a school "operating system" for principals, office staff and school boards.

Go-to-market plan: build an MVP, pilot it free with a handful of teachers for a term, gather evidence that it saves time, then sell it to French Catholic school boards (e.g., CSC MonAvenir, CECCE, CSDCEO, CSC Providence, CSDCAB) as per-school subscriptions with licensable modules.

What makes us different:

1. Built specifically for French Catholic classrooms: francisation support, Catholic identity, Ontario curriculum, Canadian French.
2. A deep, curriculum-aligned resource library where every item works at multiple French language levels.
3. Later: integration with the school's physical systems (paging, doors, intercoms, cameras) that we already install. EdTech competitors can't offer this.
4. Can be hosted by us in Canada or run on a board's own servers.

## 2. Users and roles

- **Teacher (enseignant·e):** primary MVP user. Plans, teaches, uses the library, triggers absences.
- **Substitute (suppléant·e):** no account. Gets single-day access through a code.
- **Principal / vice-principal (direction):** read-only oversight of their school in the MVP.
- **Office admin (secrétaire):** role exists in the MVP; its features come later.
- **Facilities:** later.
- **Board admin:** later. Board-wide content approval and analytics.
- **Parent:** later.

Include every role in the role model from Phase 1, even where features come later.

## 3. Classroom realities the product must respect

- **Mixed French proficiency.** Fluent francophone students sit next to students from English-speaking or newcomer homes who are still developing French (ALF and PANA programs). Differentiation by language level is central, not a nice-to-have.
- **Catholic identity is part of teaching:** Gospel values, prayer, the Ontario Catholic School Graduate Expectations, the liturgical calendar (Avent, Carême, school masses).
- **Franco-Ontarian identity-building** (construction identitaire) is part of the schools' mandate.
- **Substitutes usually walk in blind.** They don't know where the class left off, who needs language support, or who has safety/medical alerts. There is a substitute shortage, so plans must work for whoever shows up.
- **Teachers build many of their own materials** on evenings and weekends.

## 4. Language

- UI in French: Canadian French as used in Ontario French-language schools. Build i18n in from day one so an English UI can be added later.
- Code, comments, commit messages and docs in English.
- All AI-generated content follows the Canadian French rules in section 10.

## 5. Tech stack

Use this unless you have a strong reason not to; if you deviate, explain why in `DECISIONS.md`.

- **App:** Next.js (App Router) + TypeScript + Tailwind, built as a responsive PWA for desktop, iPad and phones. No native apps for the MVP.
- **Backend:** Supabase (Postgres, Auth, Storage, Row Level Security) in the Canada (Central) region for our hosted version. The app must also run on self-hosted Supabase in Docker for board-hosted installs, so avoid hosted-only Supabase features and keep business logic in the app and in Postgres.
- **Validation:** Zod everywhere, including all AI output.
- **PDF:** server-side generation (React-PDF or Playwright-rendered HTML).
- **Background jobs:** a Postgres-backed job queue for AI generation and bulk tasks. No hosted-only job service.
- **Auth:** email magic link for the pilot. Architecture ready for Microsoft Entra ID (Azure AD) and Google Workspace SSO restricted to board email domains.
- **Testing:** unit and integration tests for critical logic, plus automated tests for RLS policies.
- **CI:** lint, typecheck and tests on every push.
- **Deploy:** hosted on Vercel (or similar) + Supabase; board-hosted via Docker Compose (section 7).

TypeScript end to end also matches our other product (VantageCore), so shared code is possible later.

## 6. Privacy and security (non-negotiable)

Ontario school boards review privacy carefully before buying. These rules apply everywhere.

- **Data minimization.** Store students by first name or nickname plus an internal UUID only. Never last names, Ontario Education Numbers, birthdates, addresses, photos or student emails. CSV roster imports must drop every other column.
- **Safety/medical alerts** are the only sensitive student field in the MVP. Store them as short teacher-written text (e.g., "allergie sévère aux arachides, épipen dans le sac") in a separate table with stricter RLS. Only the teacher, the principal, and a substitute with an active code for that day can see them. Log every view.
- **AI calls never include student names or alerts.** Replace students with placeholders ("Élève A", group labels) before any model call and re-insert names server-side afterward.
- **Row Level Security on every table.** Teachers see only their own classes, substitutes only their one day, principals only their school, board admins only their board.
- **Substitute access codes** are single-day, hashed at rest, rate-limited and revocable.
- **Class mode** (student devices) uses a session join code and a team name or nickname. There are no student accounts. Session responses are deleted automatically when the session ends unless the teacher explicitly saves aggregate results.
- **Audit log** for sensitive-data access, substitute code use, content approvals and admin actions.
- **All data at rest in Canada.** Document exactly which de-identified content is sent to the AI provider.
- **Deletion and retention.** Teachers can delete a class and all its data. Define sensible retention defaults.
- **PRIVACY.md.** Write a document covering the data inventory, data flows (including the AI provider), retention, deletion and access controls, written so it can answer a school board's privacy questionnaire.
- Later modules that hold custody/pickup lists, medical binders or incident reports will need a formal privacy impact assessment. Do not build them in the MVP.

## 7. Architecture foundations (build the skeleton now)

**Module system.** A core (auth, boards/schools, classes, calendar and timetable, notifications, audit, AI service) plus feature modules that can be enabled or licensed per school through a `module_entitlements` table: Teaching, Library, Office (later), Safety & Building (later), Board Analytics (later).

**Event bus.** Internal events through a transactional outbox table, e.g. `absence.published`, `sub_plan.ready`, `library_item.approved`, and later `emergency.lockdown.started` and `visitor.arrived`. Modules and integrations react to events rather than calling each other directly.

**Integration adapters.** Define interfaces with mock implementations only; no real hardware calls in the MVP:

- Paging/PA and bells over SIP (Asterisk-based)
- Access control through our VantageCore appliance API (ICT Protege WX), e.g. issuing a day-only door credential to a substitute
- Intercoms (Akuvox) and video (Digital Watchdog DW Spectrum)
- SMS and voice notifications, and an IVR absence line

**Deployment modes (one codebase):**

1. Hosted by us in Canada.
2. Installed in a board's own data centre: Docker Compose with self-hosted Supabase/Postgres, board-controlled updates, no dependency on our cloud.
3. Later: a per-school edge appliance for building functions that must keep working offline, syncing with the central app when connected.

All configuration through environment variables, with a documented `.env.example`.

**AI provider abstraction.** A single server-side AI service module. The provider is selected by config: the Anthropic API (default), a board's own approved cloud AI account, or a local open-weight model server. Every AI feature must degrade gracefully when AI is turned off; the rest of the app stays fully usable.

**Identity and rosters.** SSO and SCIM user provisioning come later. The MVP supports manual entry and CSV roster import (first names only).

## 8. Data model (starting point; refine it)

**Core:** `boards`, `schools`, `users`, `user_roles` (role plus school or board scope), `classes`, `class_teachers`, `students` (first_name/nickname, class_id, default_language_level_id), `student_alerts` (restricted), `language_levels` (configurable per board), `timetable_blocks` (class, weekday, start/end, subject), `school_calendar_events` (PA days, masses, assemblies, early dismissals), `module_entitlements`, `audit_log`, `event_outbox`, `ai_generations` (feature, prompt version, model, tokens, latency, estimated cost).

**Curriculum:** `grades`, `subjects`, `strands` (domaines), `curriculum_expectations` (code, text_fr, curriculum_version, grade, subject, strand).

**Library:** `library_items` (type, bucket, title, status, source, author_id, licence, parent_item_id for remixes, sub_friendly, duration, formats, safety_notes, catholic_connection), `library_item_versions` (item, language_level, content JSON, answer key), `library_item_expectations` (many-to-many), `tags`, `library_item_tags`, `library_item_ratings`, `collections` (unit kits), `collection_items`, `content_packs`.

**Teaching:** `units` (class, subject, title, order), `unit_lessons` (unit, sequence_number, optional library_item_id, objectives, materials, content), `lesson_progress` (class, lesson, status, completed_at, completed_by).

**Substitute:** `absences`, `sub_plans` (absence, plan JSON, PDF path, status, reviewed_by), `sub_access_codes` (hashed code, valid date, expires_at, revoked_at), `sub_reports`.

**Catholic:** `catholic_references` (type: virtue, graduate expectation, reflection, prayer; text_fr; grade suitability; liturgical season), editable by the board.

**Class mode:** `class_sessions` (class, item, join code, expires_at), `session_participants` (nickname or team only), `session_responses` (auto-deleted).

Provide SQL migrations, indexes, foreign keys with sensible cascade rules, RLS policies with tests, and seed data: a demo board, one school, two classes (e.g., 3e and 5e année), fake students with first names only, timetables, one unit per class with lessons, a small curriculum sample, and 20–30 library items across all six buckets.

## 9. MVP features

### 9.1 Planner and lesson progress

- Weekly timetable per class.
- Units built from ordered lessons, either written by the teacher or pulled from the library.
- One-tap check-off when a lesson is taught. This progress drives the substitute plan.
- A simple "today" view showing the day's blocks and what's next in each unit.

### 9.2 Language level engine (texte différencié)

- The teacher pastes or writes a text, instructions or an activity (or picks a library item) and gets a version for each configured French language level. Every version keeps the same learning objective.
- Default levels: Débutant, Intermédiaire, Avancé, Enrichi. They are configurable per board or teacher. Do NOT present them as an official ALF or Ministry scale.
- Débutant: short sentences, high-frequency vocabulary, suggested visual supports, a glossary. Enrichi: richer vocabulary and extension questions.
- Side-by-side view, editing, printing by level, and saving the result to the library as a draft.
- Each student can be assigned a default level. The substitute plan generator uses it for grouping.

### 9.3 Content library

A large, high-quality library of classroom resources by grade and subject. Teachers use it daily, it feeds the planner and the substitute plans, and it eventually becomes a licensed content product.

**Taxonomy.** Grade → Subject → Strand (domaine) → Curriculum expectation → Resources.

- Grades: Maternelle, Jardin d'enfants, 1re to 8e année. Maternelle/jardin gets its own structure matching its program framework.
- Subjects: Français, Mathématiques, Sciences et technologie, Études sociales (1re–6e), Histoire et géographie (7e–8e), Éducation physique et santé, Éducation artistique, Enseignement religieux, Anglais (configurable start grade).
- Seed with a small real sample. Build a CSV/JSON import tool for loading the full curriculum later, and flag that we must confirm licensing before loading official Ministry curriculum text into a commercial product.

**Item types, grouped in six buckets:**

- **Enseigner (teach):** lesson_plan, anchor_chart, worked_example, teacher_guide (how to teach the concept, common misconceptions)
- **Pratiquer (practice):** worksheet, learning_centre, reading_passage, vocabulary_bank, exit_ticket
- **Explorer (explore):** experiment, stem_challenge, project, outdoor_activity
- **Évaluer (assess):** quiz, unit_test, diagnostic, rubric
- **Jouer (play):** game, brain_break, song, riddle, weekly_challenge
- **Relier (connect):** catholic_reflection, culture_hook (Franco-Ontarian culture), parent_guide (in French and English)

One Zod schema per type so every item renders consistently.

**Required metadata on every item:** grades, subject, linked expectations, duration, materials, answer key (never shown in student or class views), format flags (printable, projectable, interactive), sub_friendly flag, optional Catholic connection, tags, and a version for each language level.

Quizzes and tests support multiple choice, true/false, matching, ordering and short answer, with auto-grading where possible. Rubrics follow the Ontario achievement chart: four categories (Connaissance et compréhension, Habiletés de la pensée, Communication, Mise en application), levels 1–4.

**Provenance and review.**

- Source: ai_generated, teacher_created or board_created; author; licence/ownership terms; parent item if remixed (lineage and credit).
- Workflow: draft → teacher_reviewed → board_approved (plus rejected and archived). Only reviewed items are shared beyond their author. Board-approved items get a visible badge.
- Anonymous ratings and usage counts.

**Content rules.**

- Everything must be original. Never copy or closely paraphrase textbooks, Teachers Pay Teachers, Idéllo or other third-party material. Images must be generated or licensed, never scraped.
- Experiment and STEM items require a structured `safety_notes` field (age suitability, allergy-aware materials such as nut-free and latex-free alternatives, supervision level). Publishing is blocked without it.
- Faith content is flagged for review by someone the board designates.
- Depth before breadth: the first goal is complete, reviewed coverage for 1–2 grades and 2 subjects, not thin coverage everywhere.

**Generation.**

- On demand: a teacher picks an expectation and an item type, and the AI drafts an item into the review queue.
- Bulk: a batch job generates items for a list of expectations using the Anthropic Message Batches API for lower cost, with per-run cost caps, deduplication against existing items, and a report of what was created.
- Every item is saved with the prompt version and model that produced it.

**Discovery.**

- Browse by grade → subject → strand → expectation, with faceted filters: type, bucket, duration, format, sub-friendly, approved only, language level.
- Postgres full-text search using the French configuration plus unaccent.
- Coverage report: expectations with no or few approved items, by grade and subject.

**Delivery.**

- Print view and PDF for every item, with the student sheet and the teacher key kept separate.
- Class mode: a projector player for quizzes, games, brain breaks and step-by-step experiments. Students can optionally join from tablets with a class code and a team name or nickname; there are no student accounts. It includes quiz battles with a team leaderboard. Answer keys are never sent to student devices.
- Teacher actions: add to unit or planner, remix (copy with lineage), share to the school or board library.

**On-prem.** The library exports and imports as versioned content packs, so board-hosted installs receive updates without depending on our cloud.

### 9.4 Substitute hand-off (Plan de suppléance), the flagship

We do NOT replace the board's substitute dispatch system. The plan and access code go to whoever arrives, usually through the office.

1. **Absence button.** One tap, usable at 6 a.m. on a phone while sick. Full day, half day or multiple days, with an optional short note.
2. **Find where each class left off.** For each timetable block on the absence date(s), find the class and subject's active unit, the last completed lesson, and the next lesson(s) in sequence. Account for calendar events (masses, assemblies, early dismissals). Multi-day absences continue the sequence day by day.
3. **Prefer reviewed content.** Use board-approved, sub-friendly library items linked to the next expectations first, and generate only what's missing.
4. **Plan contents,** written for an adult who has never met the class:
   - the day's schedule and routines (entry, prière du matin, O Canada, recess, lunch, dismissal)
   - scripted, step-by-step lesson instructions
   - materials and where to find them
   - student groupings by language level, with the matching version of each activity
   - a safety/medical alert summary
   - key contacts (office, a neighbouring teacher) and end-of-day instructions
5. **Output** as a clean web view and a printable PDF, with student materials separate from the substitute's instructions.
6. **Optional review.** The teacher can edit the plan before release. If not reviewed by a configurable time, it is released as generated.
7. **Substitute access code** (PIN or magic link), delivered by SMS/email or printed at the office. Valid for that day only, and shows only that day's plan and report form.
8. **End-of-day report (Suivi de la journée).** What was completed and what wasn't, student absences, behaviour notes, notes for the teacher. It writes back to the teacher's dashboard. The teacher confirms before any lesson is marked completed.
9. **Events.** Emit `absence.published` and `sub_plan.ready` so future modules can react, e.g. issuing a day-only door credential through the VantageCore adapter or updating an office coverage board.

### 9.5 Catholic connection toggle

- When generating a lesson, a library item or a sub plan, an optional toggle adds a short, age-appropriate Catholic connection (a virtue, a reflection question or a short prayer) tied to the lesson topic.
- Draw from the seeded, board-editable `catholic_references` table where possible.
- Keep it modest and always editable. The teacher is the final authority on faith content.

### 9.6 Principal view and audit

- Read-only view for the principal: today's absences, whether each sub plan is ready and released, and library contributions from the school.
- Audit log viewer for principals and admins.

## 10. AI layer requirements

- All AI calls go through the server-side AI service module (section 7). Never call a model from the browser.
- Default model: a current Claude model (e.g., `claude-sonnet-5`), set by config.
- System prompts live as versioned files in the repo (e.g., `/prompts/<feature>/<version>.md`), not inline strings.
- **Canadian French.** Output follows Ontario French-language school usage: Ontario curriculum terms (attentes, contenus d'apprentissage, domaines), grades written as "3e année", Canadian vocabulary and conventions, no Europe-specific expressions, no anglicisms. Everything must be age-appropriate for the grade given.
- **Structured output.** Every generation returns JSON validated against a Zod schema, with retry on invalid output, then rendered to HTML/PDF. Never render raw model text.
- **Privacy.** Apply the placeholder rule from section 6 before every call.
- Language levels must keep the same learning objective across all versions.
- Sub plans must be concrete and scripted enough for someone with no context to run the day.
- Catholic content must be respectful, age-appropriate and always editable.
- **Evaluation set.** 10 sample inputs per feature with expected qualities, plus a script that runs the prompts against them. Run it before any prompt change.
- **Cost control.** Log tokens and estimated cost per request, enforce per-school monthly caps, and use the Message Batches API for bulk jobs.

## 11. Quality bar

- Every screen works on a phone, a tablet and a desktop.
- Every core flow has loading and error states and never loses a teacher's work.
- Critical logic has tests: next-lesson selection, calendar handling, multi-day absences, access code expiry, RLS policies, PII placeholder stripping, answer keys never reaching student devices, and class-mode response deletion.
- French UI copy is natural and consistent. Keep it in translation files so it can be reviewed by a teacher.

## 12. Later modules (design for these; do NOT build them in the MVP)

**Office (secretary):**

- Safe-arrival attendance: parents report absences in the app or through an IVR phone line, voicemails are transcribed into attendance, and unexplained absences trigger an automatic text home.
- Visitor management: the front-door intercom rings the office desk or phone, visitors are logged and badged, and volunteer police-check expiry dates are tracked.
- Late arrival and early dismissal log with authorized pickup lists (requires a privacy impact assessment).
- Digital medical/anaphylaxis binder that feeds substitute plans and emergency roll call (requires a privacy impact assessment).
- Permission forms with e-signature; payments stay in the board's existing system.
- Bus delay notices; room and resource booking.

**Safety & Building:**

- Emergency modes (lockdown, hold-and-secure, shelter-in-place): PA announcement in French and English, exterior doors secured through VantageCore, camera views for the principal, and a phone roll call ("classe en sécurité" / "élève manquant") for teachers and substitutes. Must work offline on the edge appliance.
- Bells and announcements driven by the school calendar: O Canada, prière du matin, text-to-speech announcements in Canadian French, and a board-wide closure broadcast.
- Drill compliance log using real timestamps from building systems.
- Device health dashboard (PA zones, doors, cameras, intercoms) for remote monitoring.
- Day-only door credentials for substitutes.

**Principal:** daily coverage board (absences, sub arrival, uncovered classes and yard duties), supervision scheduler with swaps, staff hub (memos, meeting agendas, PD sign-up), facilities work orders.

**Teaching extensions:** report-card comment assistant working from the teacher's own notes, IEP accommodation log, field trip planner.

**Board:** multi-school dashboard using aggregate data only, board-wide library approval workflow, compliance exports (data residency report, audit export, retention rules, access-request export), board-wide broadcasts.

**Parents:** absence reporting, forms, translated messages.

**Life-safety note.** Emergency features need a separate design review, redundancy, offline operation, formal testing, and sign-off against board safety and police protocols. Lockdown secures entry and must never block egress. These features supplement existing procedures and never replace them. Flag anything in the MVP that would make them harder to build later.

## 13. Build phases

For every phase deliver: code, migrations, tests for the critical logic, a "how to run and demo this" note, and a list of what to test with a real teacher.

**Phase 1: Foundations.** Repo scaffold, CI, i18n setup, full MVP schema with RLS and RLS tests, auth and roles, module entitlements, event outbox, audit log, seed data. Teachers can create classes and students (manual entry and CSV import), set timetables, build units and lessons, check lessons off, and see a "today" view.

**Phase 2: AI service and language levels.** AI provider abstraction, prompt versioning, PII placeholder layer, Zod-validated output with retries, token and cost logging, evaluation harness. Language level engine UI and default student levels.

**Phase 3: Substitute hand-off, end to end.** Absence button → plan generation → optional review → web view and PDF → substitute access code → substitute view → end-of-day report → teacher confirmation and progress update.

**Phase 4: Library core.** Taxonomy and browsing, item types and schemas, review workflow, on-demand generation, search and filters, print/PDF, add to unit, sub-plan preference for approved sub-friendly items, Catholic connection toggle.

**Phase 5: Library growth and class mode.** Class-mode player and quiz battles, remix and sharing with lineage, ratings, bulk generation with cost caps, coverage report, content pack export/import.

**Phase 6: Pilot readiness.** Principal view, audit log viewer, `PRIVACY.md`, `DEPLOYMENT.md` (hosted and Docker board-hosted), backup and restore, error monitoring, onboarding flow for pilot teachers, and a demo script.

## 14. Your first task

Don't write code yet. Please:

1. Summarize your understanding of the product in one short paragraph.
2. List your questions and the biggest risks you see.
3. Propose the repository structure and a detailed plan for Phase 1.

Then wait for my confirmation before starting Phase 1.
