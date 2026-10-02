# Handoff

Written 2026-09-28 by the session that built Phases 1 and 2 (branch `claude/nifty-fermat-8hhl1l`);
updated 2026-09-30 by the session that built Phases 3, 4 and 5 (branch `claude/serene-ride-3n2fa1`).
Read `SPEC.md` and `DECISIONS.md` first; this file covers what they don't: the conversation with
Mike, the current state, how to run things in these containers, and what's next. Phase notes:
`docs/phase-1.md`, `docs/phase-2.md`, `docs/phase-3.md`, `docs/phase-4.md`, `docs/phase-5.md`
(and `docs/content-packs.md` for a board's IT).

## 1. The brief

**Who.** Mike McLeod, IP Lynx Inc., an Ontario security and telecom integrator that already installs
paging/PA, access control, intercoms and video in schools, including for a French-language school
board (SPEC §1). Mike is the product owner. He is not writing code himself; talk to him in plain
language.

**What.** A platform for French-language Catholic elementary schools in Ontario (Maternelle to
8e année): teachers first (planning, "Aujourd'hui", substitute hand-off, differentiated texts,
resource library), then principals, office staff and boards. Per-school subscriptions with
licensable modules later.

**Pilot.** No school board is a client yet. Mike will run a free beta with teacher friends and his
sister (a teacher), then adjust. He asked for "as much flexibility on set up as possible so it could
be rolled out to other school boards" and to make the best assumptions, which he'll correct after
the beta (DECISIONS D-001, D-003).

**Constraints he set or approved:**

- **Language:** French (Canadian, Ontario school usage) first, with an English toggle he asked for.
  Inclusive writing (D-033). Commit messages, code and docs are in English.
- **Catholic:** masses, morning prayer, religious education and Catholic references are part of the
  model (seeded) and must stay respectful and editable.
- **Privacy is paramount** (his words). First names only for students; alerts encrypted, hidden and
  audited; RLS everywhere; data at rest in Canada. For AI: **"if the information leaves Canada it
  can't hold ANY personal data, and encrypted traffic if possible."** Students never use AI; only
  teachers and the direction (principals and vice-principals) do.
- **Hosting:** our hosted version in Canada or board-hosted with Docker (SPEC §7). In the hosted
  version the database (Supabase Canada Central) **and** the web server and worker must run in a
  Canadian region: they handle teachers' text with real names before de-identifying it (D-029,
  `docs/ai-data-flow.md`). Nothing hosted yet.
- **AI:** Mike pays during the beta, with his own Anthropic key. He chose **Claude Opus 5.5, medium
  effort**. Budgets: $50–100 per school per month, with tiers and pooling across a board's schools;
  he manages it and bills each board monthly. As implemented (D-040), amounts are **US dollars of
  provider (Anthropic) cost**, not the price charged to boards: default allowance 50 USD per school,
  ceiling 2x; what Mike charges boards is separate.
- **Budget/deadlines:** none given beyond the AI budget above. "No urgency" on the product name.

**The name.** "Lynx École" is a placeholder (`APP_NAME`, read at run time since Phase 6, D-113).
Mike is open to anything and "so far likes something with Tableau". I flagged that "Tableau" alone
is a big Salesforce software brand and suggested **« Au tableau! »** (also: Présent!, Tableau noir,
Mon Tableau, Cartable, Ardoise). No availability or trademark check has been done yet.

## 2. Current state

**Branches and PRs.**

- [Vickrx7/schoolapp#1](https://github.com/Vickrx7/schoolapp/pull/1) (draft, branch
  `claude/nifty-fermat-8hhl1l`): Phases 1 and 2. Not merged; no reviews.
- [Vickrx7/schoolapp#2](https://github.com/Vickrx7/schoolapp/pull/2) (draft, branch
  `claude/serene-ride-3n2fa1`, stacked on #1): the Phase 2 hardening, Phases 3, 4 and 5. Once
  #1 is merged, retarget #2 to `main`.

**Commits on #2:**

| Commit    | What                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| `9bba837` | Phase 2 hardening: privacy layer, AI limits, the « Différencier » screens (41 fixes)     |
| `25f9659` | Phase 3 groundwork: the plan builder (`packages/domain`) and the database behind it      |
| `f6a6816` | Merge of the fact-checked handoff note from PR #1's branch                               |
| `16cc8fa` | Absence form, absence page, plan review and editing, Fiche, worker refresh               |
| `e46a56f` | Codes, the substitute portal, the office and direction board                             |
| `9aa32d8` | CI prints the page snapshot of a failed browser test                                     |
| `36c5b91` | Office account kept in French for the browser tests (CI fix)                             |
| `21f9ba6` | The substitute's report, the teacher's confirmation, PDFs                                |
| `edd830b` | Phase 3b: « Consignes détaillées (IA) » and the students' activity sheets                |
| `31412d8` | Phase 3 hardening (26 review findings) and the Phase 3 docs, decisions D-047 to D-060    |
| `6f29480` | Phase 3 tests: ending the day unsent, step undo, the editor staying open                 |
| `8230bb1` | Phase 4 head start: `@lynx/content` and the 29 demo resources (merged branches)          |
| `5200997` | Phase 4 database: saving, review, sharing, board approval; D-061 to D-081                |
| `166483b` | Library item page, printing, the demo seed and the curriculum import                     |
| `b1cdcbe` | Library search, browsing by attente and PDFs (and a PDF font fix for all PDFs)           |
| `c871b45` | Marketing: bilingual landing page, board fact sheet, promo script v2 (and 2 fixes)       |
| `ebe1a8f` | Writing, review, sharing, planning and AI generation of library resources                |
| `703da28` | Substitute plans use reviewed library resources                                          |
| `9d45e0e` | Phase 4 hardening (30 review findings) and the Phase 4 docs                              |
| `958fd3f` | The ratings table in the Phase 4 security review                                         |
| `e0ab7de` | Phase 5 head start: class-mode slides and the content pack format (pure code, tests)     |
| `d37bbb6` | Phase 5 head start: class portal codes and gate, coverage and lineage views (pure)       |
| `219d5bb` | Library expansion: 49 more demo resources (78) and the curriculum sample, « À vérifier » |
| `a01e06d` | Phase 5 foundation: D-082 to D-101, settings, messages, empty hooks, admin, worker tasks |
| `d76f084` | Phase 5: class-mode database, « Présenter à la classe », « Adapter », « Votre avis »     |
| `f7a0ce6` | Phase 5: quizzes on class devices (`/jouer`) and « Couverture du curriculum »            |
| `587a0e1` | Phase 5: bulk generation of board drafts and content packs (admin CLI)                   |
| `24ad631` | Phase 5 hardening (14 review findings) and the Phase 5 docs                              |
| `3aaf668` | Marketing: app screenshots; `88bb93b` the library and class mode shown as available      |
| `3e3f1bb` | Phase 6 foundation: D-102 to D-120, shared schema, settings, navigation, stubs           |
| `ca21d2c` | Phase 6 S1: invitations, roles, access, deletions, sample classes, settings (database)   |
| `0d85e15` | Phase 6 S2: audit viewer, AI usage totals, retention, heartbeats (database, worker, CLI) |
| `598ee7b` | Phase 6 S3a: scrubbed logs, error references, health checks, security headers            |
| `8010537` | Phase 6 S3b: Docker images, Compose installs, encrypted backups and restores, CI jobs    |
| (latest)  | Phase 6 S4: « Conseil » for board admins, and the worker's staff accounts                |

**Verified (locally, from an empty database, and in CI on each pushed commit):** 1188 unit tests
(none skipped), 1611 pgTAP tests, 89 integration tests (plus the 3 of `restore-smoke`, which run
after a restore: the `backup-restore` CI job and the local drill; the staff-account tests talk to
the stack's real Auth server), 104 Playwright tests (desktop, phone and tablet, axe on every Phase
3, 4 and 5 page and every « Conseil » page), lint, typecheck, format, generated DB types
up to date, the demo curriculum and library seeds up to date (`pnpm library:seed:check`), web
build with no setting built in; in CI also a backup restored into an empty database, and both
Docker images run as a board-hosted install (`docker-smoke`).

**Phase 3 is complete** (3a and 3b; see `docs/phase-3.md`): absence button, plans built in the
request and kept current by the worker, review and editing, release at 07:30, codes, the
substitute's portal and report, the teacher's confirmation, the office and direction board,
PDFs, the « Fiche de suppléance », AI detailed instructions and student activity sheets. A
review of the build found 26 problems; all are fixed with tests in the latest commit (security:
a cut device's code closes to new devices, a global cap on failed code attempts, the issuer of
every code in the audit trail, the owner's rights ending with her teacher role; correctness:
report confirmation against the version shown, request ids tied to their dates, back-to-back
absences, plans rebuilt from stale sources, the day's access following the codes issued;
screens: the phone bar, 44 px targets, drafts, French `lang` on plan content, and more).

**Phase 4 is complete** (see `docs/phase-4.md`): « Banque de ressources » with search in French
and filters, browsing by attente, 25 resource types with one editor, the review workflow with
reviewers designated by the board (content and faith), sharing with a first-name check, print
and PDF (student sheet and teacher copy apart, never a level name, never a key on a student
sheet), attaching a resource to a lesson, AI generation and level versions (fake provider only),
substitute plans that use reviewed resources, original demo resources (29 at the end of Phase 4,
78 since the library expansion, with a wider curriculum sample for 3e and 5e flagged « À vérifier »)
and the curriculum import tool. A review of the build found 30 problems; all are fixed with tests in the latest
commit (governance: faith content could stay on the whole board after an edit, AI level versions
reached colleagues unreviewed, an author who left the board could still widen sharing; plans: a
lesson's own resource could be taken by an earlier lesson, a hidden resource left its step;
search: « 1000 » vs « 1 000 », « B1.2 » matched its siblings; screens: a reviewer's « Page
introuvable » after sending back, a save silently withdrawing a request, saved texts unreachable
without the Library module, the phone filter sheet losing focus, the question editor's undo and
focus, `lang` on English labels, 44 px targets, English and French copy, and more).

**Not verified:** nothing has been sent to the real Claude API (« Texte différencié »,
« Consignes détaillées », « Créer avec l'IA », « Créer les versions manquantes »):
`ANTHROPIC_API_KEY` is not set in this environment. No hosted deployment exists; the reverse
proxy and the portal role's password are deployment steps written in `docs/phase-3.md`.

**Phase 5 is complete** (see `docs/phase-5.md`): « Présenter à la classe » (a projector player
for quizzes, games, brain breaks, experiments and any projectable resource, with no database
session); « Quiz sur les appareils » (students join from class tablets or Chromebooks with the
bookmarked class link or a 6-character code, no accounts, numbered devices and fixed team names,
every question kind, team or solo play, answers graded in the database, answer keys never on a
device, answers and devices deleted when the session ends, class results kept only if the teacher
asks); « Adapter » (a private copy with credit and a sharing cap); « Votre avis » (anonymous stars
on board-approved resources) and usage on every card; « Couverture du curriculum » (page and CLI);
bulk generation of board drafts through the Message Batches API with a hard cost cap (operator
CLI, fake provider only here); content packs (export, a real dry run, import into the board's
approval queue; `docs/content-packs.md`). Devices reach the database only through
`lynx_class_portal` (`apps/web/src/server/class-portal/`, fenced by an ESLint rule and its unit
test); its local password is in `seed.sql`, and production needs the deployment step in
`docs/phase-5.md`. A review of the build found 14 problems; all are fixed with tests in the
latest commit (keys: the option ids sent to devices could give away ordering and matching
answers, and with answers hidden the projector showed how many were right; screens: the right
answer's text squeezed to a letter a line at 1366 × 768, a lobby that did not fit 4:3 and 16:9
laptops, a reveal that did not scroll to the answer, a small answer count, the presenter's timer
over the slide, 20 px device text, content language in accessible names, a French plural;
opinions that could reveal colleagues' stars; unaudited deletion of board resources; deleted pack
resources coming back with the next version).

**Phase 6 (pilot readiness) is being built**, one slice at a time (S0 foundation, then S1 accounts
and settings in the database, S2 audit viewer and retention, S3a web operations, S3b Docker, backups
and CI, S4 « Conseil », S5 « Direction » and the audit log, S6 onboarding and feedback, S7 documents
and demo). Decisions D-102 to D-120. The foundation (latest commit) adds the shared schema
(`20261201090000_pilot_schema.sql`: invitations, feedback, the audit action catalogue,
heartbeats, the terms and sample-class columns), renames the web settings (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `APP_NAME`, read at run time; the `NEXT_PUBLIC_*` names still work), adds
« Direction » and « Conseil » to the navigation with each role's landing page (both pages say
« arrive bientôt » until their slices), and registers the new worker tasks and admin commands as
stubs (« pas encore disponible »). Slice S1 (`ca21d2c`,
`20261201090100_pilot_accounts.sql`, pgTAP `27`) puts accounts, onboarding, settings and feedback
in the database: board admins invite staff within their own board (the worker creates the account
in slice S4), grant and revoke roles, remove and restore access, set a school's contact details and
bell times, and designate library reviewers, each naming a person by one of their roles in the
board (no function a signed-in user may run takes a user id); the alerts switch and the substitute
settings stay the direction's; the pilot terms, sample classes (never in a substitute plan) and
feedback have their functions; and the operator's `pnpm admin log-operator-access`, `delete-user`
and `delete-board` work (D-106, D-107 « As built »). There are no screens for them yet (S4, S6).
Slice S2 (`0d85e15`, `20261201090200_audit_retention.sql`, pgTAP `28` and `29`) closes the raw
audit table to the API and serves the « Journal d'audit » through `list_audit_entries` (the
school's direction reads alerts, absences and substitute days; board admins read administrative
and approval entries only; labels per viewer, never a student's name; the export is audited), adds
a guard that refuses free text in audit entries, audits the operator's settings, modules and
budgets for the board, makes AI usage rows private to their author with per-school totals for board
admins (`board_ai_usage`), and implements retention: the nightly `retention_maintenance` purges
plans, absences, classes' students (the planning stays), sample classes, usage, feedback,
invitations, the outbox, Supabase Auth's log and the audit log, per board within
`settings.retention` (`pnpm admin set-retention`, a year at least). The worker beats every minute
on its own timer and answers `/healthz` (`WORKER_HEALTH_PORT`); board admins get
`system_status()` and the operator `pnpm admin status` (D-103 to D-106, D-112 « As built »). The
screens come in S4 and S5. Slice S3a (latest commit) adds the web operations: `@lynx/observability`
writes every log line of the web server and the worker as scrubbed JSON (no e-mail, phone number,
postal code, identification number, token, quoted text or value Postgres echoes back; errors keep
their name, SQLSTATE, digest, scrubbed message and frames, never their other properties), Next's
own console output included; error pages show « Référence : … », the digest or reference that is
in the matching log line, and browsers report their errors to `/api/client-error` (name,
reference, route template, a hash of the message); `/api/health` and `/api/health/ready` for
monitors; the Content Security Policy and `X-Robots-Tag` on every page (not on PDFs); and an ESLint
rule against `NEXT_PUBLIC_` (D-111, D-112, D-113, D-119 « As built »). No third-party error
service: logs stay on the server. Slice S3b (`8010537` to `b161445`) adds deployment (`deploy/`): two images
(`web`, `app`) configured at run time, Docker Compose for the hosted install and for a board's own
servers (with a minimal self-hosted Supabase), `generate-secrets.mjs`, `migrate.sh` (a backup first
when migrations are pending on a database with data), `upgrade.sh`, nightly encrypted backups and
a checked restore (`deploy/backup/`), the worker's refusal to start on a database without its
migrations, the session limits (7 days, 12 hours idle), and three CI jobs besides the two existing
ones' checks: `backup-restore`, `docker-smoke` and the migration-name and `NEXT_PUBLIC_` checks
(D-114, D-115, D-119 « As built »). `DEPLOYMENT.md` comes with slice S7. Slice S4 (latest commit)
replaces the « Conseil » placeholder with « Administration du conseil » (`/board`): what the board
still has to set up, « État du système » and « Conservation des données », then « Personnel »
(invite within the board; the worker now creates the Auth account and the page gives a French or
English message the inviter sends by e-mail or text; remove a role, add one, remove and restore
access, with the worker banning and unbanning the sign-in), « Écoles » (contact details and bell
times, also on « École » for the direction; the AI switch; the rest read only), « Années
scolaires », « Approbation des ressources », « Utilisation de l'IA » (per school, with a CSV) and
« Commentaires reçus »; board admins add board-wide PA days and holidays in « Calendrier », and the
direction's substitute settings are now merged in the database (D-104, D-107, D-108, D-112, D-116,
D-118 « As built »). The « Journal d'audit » tab comes with slice S5.

**Other deliverables:**

- **Promo video:** a 60 s stop-motion commercial (English, Kokoro voice `af_heart`) and a 67 s
  French version (voice `ff_siwis`, which has a France-French accent). Sources in
  `marketing/promo/` (rebuild steps in its README; models, venv and videos are git-ignored). The
  sick-day plan is labelled « Bientôt » there: it now exists.
- **Screenshots:** Phase 1 screens in `marketing/promo/screens/`. None of Phases 2 to 4 are kept;
  retake them from the running app if needed.
- **Marketing site and board fact sheet** (`marketing/site`, `marketing/one-pager`, promo script
  v2): they claim only what ships and still label the library « En construction ». Update that
  once Mike has seen Phase 4.

## 3. How to run it (in these containers)

Docker doesn't work here (image pulls are blocked: Docker Hub 429, ECR/GHCR blobs 403), so use the
**lite stack**, which runs the same Supabase pieces as plain binaries on the same ports and keys
(`tools/lite-stack/README.md`). CI uses the real Supabase CLI. The Docker files in `deploy/` are
built and run only by the `docker-smoke` CI job; here, `docker compose config` checks the Compose
files without a daemon (from `deploy/docker`, with `--env-file` pointing at a file made by
`node generate-secrets.mjs --ci --out <file>`).

```bash
pnpm install
cp .env.example apps/web/.env.local        # demo keys; AI_PROVIDER=fake
tools/lite-stack/stack.sh reset            # downloads Auth/PostgREST/Mailpit once, migrates, seeds
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                                  # unit
tools/lite-stack/stack.sh test             # pgTAP (needs pg_prove; was preinstalled here)
SUB_PORTAL_DATABASE_URL=postgresql://lynx_sub_portal:lynx-sub-portal-local-only@127.0.0.1:54322/postgres \
  pnpm test:int                            # integration (worker stopped; needs DATABASE_URL)
pnpm db:types:direct                       # regenerate types (needs DATABASE_URL, else it tries :5432)
pnpm library:seed:check                    # the demo library seed matches content/library/demo

pnpm --filter @lynx/web build
(cd apps/worker && set -a && . ../web/.env.local; set +a && \
  AI_PROVIDER=fake AI_FAKE_DELAY_MS=300 nohup pnpm start > /tmp/worker.log 2>&1 &)
cd apps/web && PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  MAILPIT_URL=http://127.0.0.1:54324 pnpm exec playwright test   # starts `next start` itself
```

(The Chromium path depends on the container image: `ls /opt/pw-browsers`. With a server already
running, set `E2E_BASE_URL=http://localhost:3000` instead.)

Demo logins are in `supabase/seed.sql` (e.g. `isabelle.tremblay@demo.lynx.test`, principal
`sophie.lavoie@demo.lynx.test`). The 6-digit code arrives in Mailpit: `http://127.0.0.1:54324`.

**Quirks that cost time:**

- **Keep the e2e worker on the fake provider.** With `AI_PROVIDER=anthropic` and a key set, the
  browser tests would call (and pay for) the real API.
- **Restart the worker after changing `packages/ai`.** `pnpm start` runs tsx without watch;
  `pnpm dev:worker` watches and reads `apps/web/.env.local`.
- **Stop the worker before `pnpm test:int`.** A running worker takes the outbox test's job before
  the test can see it (CI starts the worker only after the integration tests).
- **Stopping processes safely.** Don't kill with `pkill -f "next start"` or `pkill -f "tsx ..."`:
  the pattern matches your own shell and kills it (exit 144). `pgrep -x next-server` doesn't match
  either, because the process is named `next-server (v16…)`. Use
  `ps -eo pid,args | grep -E "[n]ext-server|[t]sx.*src/index.ts"` and kill those PIDs.
- **After a rebuild, restart `next start`,** or an old server keeps port 3000.
- **Login codes:** Auth allows one code per address per second. The e2e login helper retries.
- **Clicks can happen before hydration** in e2e, and are then lost. Wait for a state or use
  `expect(...).toPass()` (see `e2e/differentiate.spec.ts`).
- **`getByLabel` reads the whole `<label>`,** `aria-hidden` parts included (« 1. cent »). When a
  label carries a hidden number or icon text, use `getByRole(..., { name, exact: true })`.
- **Screen-reader text inside a sideways-scrolling box** (`sr-only` is absolutely placed) needs a
  `relative` box, or it pushes the whole phone page sideways (the coverage overview).
- **Directories named `coverage`** are source code (`/library/coverage`): `.gitignore` and ESLint
  skip only the test-report folders (`/coverage/`, `apps/*/coverage/`, `packages/*/coverage/`).
- **`next dev` writes `AGENTS.md` and `CLAUDE.md`** into `apps/web` unless `agentRules: false`
  (set in `next.config.ts`).
- **Lite stack vs CLI drift found so far:**
  - `[auth.email] enable_signup = false` turns email login off entirely in the CLI (fixed in
    `supabase/config.toml`; the lite stack now reads it).
  - The lite stack used to re-grant default table privileges on every start (fixed in
    `bootstrap.sql`).
  - New tables must `revoke all ... from anon, authenticated` explicitly.
  - Auth had no default group here, so accounts made through its admin API got an empty role,
    and PostgREST refused their tokens (the app said « pas d'accès »). `stack.sh` now sets
    `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` as the CLI and Compose do, and the worker sets
    the role itself (D-107). Restart the stack (`stack.sh reset`) to pick it up.
  - `supabase/tests/00_schema_invariants.test.sql` catches most of this.
- **Network:** GitHub Actions artifact downloads (`*.blob.core.windows.net`) are blocked by the
  egress policy. Read CI failures from the job logs: a failed browser test prints its page
  snapshot there (`e2e/failure-context-reporter.ts`).
- **The portal roles survive resets.** `lynx_sub_portal` and `lynx_class_portal` are cluster
  roles: `stack.sh reset` drops the database, not the roles, so migrations create them only if
  missing and the seed sets their local passwords again. `pnpm test:int` also needs
  `SUB_PORTAL_DATABASE_URL` (in `.env.example`).
- **Migrations are applied once.** The lite stack does not re-apply an edited migration: after
  editing one that is not committed yet, `stack.sh reset`. Never edit a committed migration; add
  a new one (the latest is `20261201090200_audit_retention.sql`, pgTAP file `29`).
- **Seeds come in two parts.** `supabase/seed.sql`, then `supabase/seeds/*.sql` by name
  (`config.toml` `sql_paths` for the CLI, `cmd_seed` in `stack.sh`). `seeds/20_library_demo.sql`
  is generated from `content/library/demo`: after changing the pack, run `pnpm library:seed`
  (CI runs `pnpm library:seed:check`); never edit it by hand.
- **Phase 3 browser tests** need the worker (`AI_PROVIDER=fake`) for the refresh and AI
  scenarios, move code windows around the real clock (`e2e/db.ts` `openCodeWindow`) and clean up
  after themselves; `e2e/mobile.spec.ts` briefly gives Isabelle a vice-principal role.
- **Phase 4 browser tests** title their resources `e2ePrefix()` (« E2E-… » in base 36: a
  13-digit timestamp reads as an identification number to the privacy guard) and delete them;
  `differentiate.spec.ts` briefly turns the school's Library module off, `library-ai.spec.ts`
  turns AI on and puts it back. A result's link carries the search (`?q=…`), so wait for item
  URLs with the query.
- **Phase 5 browser tests** end any open session of Isabelle's 3e année before and after, clear
  the join failures (every test device comes from 127.0.0.1), and play on a `Galaxy Tab S4`
  context (Chromium only here; iPads are checked by hand). The projector test walks through the
  classroom screen sizes (1920 × 1080 down to 1024 × 768). Opinions count for colleagues once a
  day old (D-093): the demo seed dates its two opinions a week back, and pgTAP's
  `tests.growth_rate` backdates the ones it gives.
- **axe after a server action:** `router.refresh()` replaces the page's head, and axe run at that
  instant finds no `<title>`. `expectAccessible` waits for the title; a spec that checks right
  after a toast should also wait for something the refresh changes (`library-authoring.spec.ts`
  opens « Détails » and waits for « Partagée avec l’école »).
- **Watching the class portal locally:** `CLASS_PORTAL_DATABASE_URL` in `.env.example` logs in
  as `lynx_class_portal` with its local-only password (set by `seed.sql`; the role survives
  resets). `tools/load/class-mode-load.ts` plays a class of 30 simulated devices against a
  running server.
- **Library reviewers** come from `seed.sql` (Nathalie Roy, content and faith); on a real board
  nobody reviews until `pnpm admin set-library-reviewer` (docs/phase-4.md).
- **PDF fonts are warmed once per server process.** The PDF library keeps one glyph per letter
  for the life of the process, so an accented capital in one PDF could drop the plain letter from
  later ones, and a ligature could split words. Every render in `server/pdf/render.ts` calls
  `warmPdfFonts()` first (`server/pdf/fonts.ts`); a new PDF must go through `render.ts` too.
- **Deletes:** `rm -rf *` style commands are refused by a safety check. Use explicit paths.
- **Production logs are JSON lines** (D-111): `next start`, the standalone server and the worker
  print every console message, Next's error reports included, as scrubbed JSON (from the web
  server's first request on), so quoted values and addresses in error messages read « … » and
  « [courriel] ». To debug, match a user's « Référence » to the `digest` or `ref` of a log line,
  then reproduce with `pnpm dev`, which does not scrub.
- **Security headers:** the Content Security Policy is built into production builds only
  (`apps/web/src/lib/security-headers.ts`); a new third-party script, font, image host or API
  call from the browser will be blocked and must be a deliberate change there (the browser never
  calls Supabase).
- **Inlined settings check (D-113):** delete `apps/web/.next/dev` (left by `next dev`, it holds
  the development value), build with `SUPABASE_URL=http://build.invalid`, then
  `grep -rl build.invalid apps/web/.next` must find nothing.
- **Next warning:** "next start does not work with output: standalone" is harmless in tests. The
  standalone server is at `apps/web/.next/standalone/apps/web/server.js` (monorepo tracing root);
  the `web` image runs it (`deploy/docker/Dockerfile`).
- **`build.invalid` in `.next/cache`:** Next's build cache records the settings a build saw, so the
  inlined-settings check greps `.next` without its `cache` directory (never shipped).
- **Restore drill (local, Postgres 16):** with the worker stopped, `psql … -f
deploy/ci/restore-fixture.sql`, `psql … -f deploy/backup/fingerprint.sql > before`, `age-keygen`,
  `deploy/backup/backup.sh` (`BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_DIR`),
  `tools/lite-stack/stack.sh fresh`, `deploy/backup/restore.sh <file> --identity <key> --db-url …
--yes`, the fingerprint again and `diff`, then `RESTORE_SMOKE=1 pnpm test:int restore-smoke`
  (with `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env.example`). Run `stack.sh reset` afterwards.
- **`pnpm test:int <name>`** filters by file name (`pnpm test:int -- <name>` runs every file).

## 4. Environment ("School app")

**`ANTHROPIC_API_KEY`** (needed only for real AI):

- Mike's Anthropic key. He was told to add it as an **environment variable** in the "School app"
  environment. Check with `[ -n "$ANTHROPIC_API_KEY" ] && echo set`, and never print or commit the
  value.
- Read by the worker (with `AI_PROVIDER=anthropic`) and by `pnpm ai:eval`.
- Adding it as an "API credential" instead (egress header `x-api-key` for `api.anthropic.com`)
  failed 4 times with "Failed to create egress credential". Hence the plain variable, in an
  environment only this project uses. Mike was advised to set a low spend limit on it in the
  Anthropic Console.

Everything else comes from `.env.example` (copy it to `apps/web/.env.local`). It uses the local demo
keys, and none of it is secret:

- **Web:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_BASE_URL`, `APP_NAME`, `APP_RELEASE`
  (the old `NEXT_PUBLIC_*` names are still read as fallbacks; D-113), `SUPPORT_EMAIL` and
  `PRIVACY_CONTACT_EMAIL` (optional), `ALERTS_ENCRYPTION_KEYS` (a dev-only key is included), and
  for the substitute portal `SUB_PORTAL_DATABASE_URL` (local-only password), `SUB_CODE_HMAC_KEYS`
  (dev-only key), `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` (production needs an appending reverse
  proxy; `docs/phase-3.md`). The README has the full table.
- **Admin CLI:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Worker:** `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (staff accounts,
  D-107), `WORKER_HEALTH_PORT`, `APP_RELEASE`, `HEARTBEAT_URL_WORKER` (D-112),
  `WORKER_CONCURRENCY`, `OUTBOX_BATCH_SIZE`, `INTEGRATIONS_MODE`, `LOG_EVENTS`, `AI_PROVIDER`
  (`none` | `fake` | `anthropic`), `AI_MODEL` (default `claude-opus-5-5`), `AI_EFFORT` (default
  `medium`), `AI_JOB_RETENTION_DAYS` (default 30).
- **Optional, not in `.env.example`:**
  - `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK`: prices for models the app doesn't
    know (`packages/config/src/index.ts`).
  - `AI_FAKE_DELAY_MS`: simulated latency of the fake provider (default 800).
  - `PROMPTS_DIR`: where the prompts live (default: the repo's `prompts/`; read by
    `packages/ai/src/prompts.ts`).

Network access "Trusted" (same as Default) is enough: npm, GitHub release downloads,
`api.anthropic.com`.

## 5. Decisions and preferences from the chat

Where an item is already in `DECISIONS.md`, the D-number is given. Don't add duplicate entries.

- **How Mike likes to work.**
  - Short, plain answers with a recommendation, not a menu.
  - He answers casually and fast, and prefers "use your best judgment" over long question lists.
  - He does want to see the plan before a new phase (SPEC: "Don't start a phase until I confirm the
    plan"). For Phase 2 he confirmed by answering the questions and saying "let's build phase 2".
  - Explain anything he has to click (environment settings, keys) step by step. He follows along
    on the web/phone app and sends screenshots.
  - Never ask him to paste keys in chat.
- **PR style.**
  - Draft PRs with plain-language descriptions; commit messages in English.
  - End commits and PRs with the attribution trailers your own session's instructions give you.
    Apart from those, don't say which AI model wrote the code. Naming the app's configured AI model
    (a product setting) is fine.
  - Keep CI green, and fix red CI before anything else.
- **UI copy (D-033).** French-first, Canadian, inclusive writing; English kept in sync (a unit test
  checks keys and placeholders). What staff type stays as typed.
- **Approved by Mike:**
  - the English toggle;
  - Phase 2 scope;
  - Opus 5.5 at medium effort (D-041);
  - $50–100 per school with pooling, and monthly billing by him (D-040; see the USD note in section 1);
  - his own key during the beta;
  - "no personal data leaves Canada";
  - AI only for teachers and the direction (principals and vice-principals; D-039);
  - the French promo;
  - a separate environment for this project (he created "School app").
- **Suggested, not yet answered:**
  - a zero-data-retention agreement with Anthropic before real students' names are in the app;
  - a hosted beta before showing teachers (needs his accounts: Supabase in Canada Central, a host
    for the web server and worker in a Canadian region, an email sender);
  - the product name.
- **Pooling detail (D-040).** A school can always use its own allowance even after others borrowed
  from the pool, so a board can go over its pool by at most what was borrowed. Mike hasn't
  commented on that nuance.
- **Printouts never show level names** (D-042): no student is labelled « Débutant ». A small number
  marks the level for the teacher.
- **The promo claims only shipped features.** The sick-day plan is labelled « Bientôt ».

## 6. Next steps (in order)

1. **Show Mike Phases 3, 4 and 5** with a short summary each: the three questions in
   `docs/phase-3.md`, the six in `docs/phase-4.md` (we built on the recommended answers:
   reviewers named by the board, school and board sharing before approval with faith content
   faith-reviewed first, AI may draft faith reflections, AI level versions by default, the 78 demo
   resources shown to pilot teachers; who owns shared content is still open) and the six in
   `docs/phase-5.md` (devices optional, answers shown by default, device numbers instead of
   nicknames, IP Lynx runs bulk generation with a cap per run, teachers' resources out of packs by
   default, principals may give opinions). Update PR #2's description.
2. **Real-API evaluation**, once `ANTHROPIC_API_KEY` is set and Mike agrees: `pnpm ai:eval --yes`
   (11 cases, about $1.60), `pnpm ai:eval --feature sub_plan --yes` (11 cases, about $2), then
   one library case alone (`pnpm ai:eval --feature library_item --case quiz-5e --yes`, under $1)
   before `--feature library_item` and `--feature library_levels` (about $3–5 together), and one
   batch case (`pnpm ai:eval --feature library_item --case quiz-5e --batch --yes`, a worst case of
   about $0.70) before any real bulk run. Reports go to `packages/ai/eval-results/` (git-ignored):
   send them to Mike. Propose prompt changes first; never edit a used prompt version (add `v2`).
3. **Get PRs #1 and #2 reviewed and merged.**
4. **Test with real teachers and a real substitute** (`docs/phase-3.md`, `docs/phase-4.md` and
   `docs/phase-5.md`, « What to test »), including a teacher reading five demo resources for
   Ontario French and a class playing a quiz on its own tablets and projector.
5. **Hosted beta**, when Mike provides the accounts: Supabase in Canada Central, web and worker
   in a Canadian region, real SMTP, secrets (including both portal roles' passwords, the code
   keys and the class portal key), a reverse proxy set up as `docs/phase-3.md` says, and a
   zero-data-retention request to Anthropic (ask whether batches are covered). This pulls part of
   Phase 6 (`DEPLOYMENT.md`) forward.
6. **Phase 6** (SPEC §13): being built (above); its questions for Mike are in the plan's J2 and
   will be in `docs/phase-6.md`.
   « Essayer comme les élèves » (a Phase 4 hook, D-081) was not built in Phase 5.
7. **Name.** Once chosen: check availability, then rename `APP_NAME`, the icon, the
   login email template and the promo.

**Known issues and risks:**

- **Real API untested** (above), batches included.
- **Class mode on real classroom hardware** is untested: projectors at their real resolution,
  school Wi-Fi filters, managed Chromebooks keeping the class link bookmark, iPads (no WebKit
  here). The projector layout is checked from 1024 × 768 to 1920 × 1080 in the browser tests.
- **The class link is stored in plain text** (the teacher shows it again); a leaked dump lets
  someone into that class's lobby while it is open, nothing more (« Remplacer le lien », D-084).
- **Opinions and collusion:** two colleagues acting together can learn one value a day about
  the others' stars from the rounded average (D-093).
- **Pack files hold answer keys** and a checksum is not a signature (D-099, D-100).
- **Substitute access codes are bearer credentials.** Whoever holds a code (the office staff
  member who issued it included) sees the day's plan and alerts. It is audited with the issuer's
  id and role; the Phase 6 audit viewer should flag office-issued sessions (D-056).
- **Throttling needs the reverse proxy.** Reached directly, a client chooses its address and
  drops its device cookie; the 50-bit code and the global cap of 300 failures a minute remain
  (D-051).
- **The worker must run** for plans to follow later changes; publishing does not need it.
  It records a heartbeat every minute and answers `/healthz` (D-112); the external checks and the
  on-call person are deployment steps (S3b, S7).
- **Retention runs nightly** (D-105): plans and structured reports a year after their date,
  students' first names a year after their school year (units and lessons stay, and may hold names
  a teacher typed), the audit log two years. The bounds are Assumptions pending a lawyer.
- **The preview can under-report replacements.** The worker de-identifies with at least everyone
  the preview knows, so the preview can under-report replacements but never over-promise.
- **Unknown names** (a parent, a student from a school where the teacher doesn't work) only get
  caught by the teacher at the preview.
- **Historical figures** who share a student's first name get replaced, then restored.
- **Very short names** that match a French word once accents are removed (« Tú », « Lê », « An »)
  replace that word everywhere. A student named « Tú » would make the last check refuse every
  request for that school (the prompt begins with « Tu aides »). Fix: match such names only with
  their exact accents.
- **Very short parts of staff names and particles** are replaced on their own only after an
  honorific (« Mme Lê »).
- **The budget is a soft limit:** checked when a request is made and again when the worker starts
  it, so calls already running can go slightly over. Fake-provider costs count in development.
- **Clicks before hydration** can be lost in browser tests on a slow CI runner; specs retry with
  `expect(...).toPass()`.
- **Deleting a level in use is refused** with a message suggesting to turn it off.
- **Library readiness is checked twice:** the database checks what is present; the content schema
  and the key's completeness are checked by the app. An API caller could mark reviewed a resource
  whose content fails the schema; the renderer copes (D-067).
- **The library's first-name check knows the teacher's own students only;** faith content relies
  on the author's box, the keyword suggestion and reviewers' flag (docs/phase-4.md).
- **Who owns shared resources is open** (Phase 4 question 5): licences are empty.
- **Office staff can read shared resources' answer keys through the API** (not personal data; no
  library screens).

**Waiting on Mike:** the three Phase 3 questions; the six Phase 4 questions (above all who owns
shared content, and who reviews for a pilot board); the product name; the hosted beta accounts;
the zero-data-retention request; OK on the budget pooling nuance; whether the France-French promo
voice is fine; the real-API evaluation go-ahead (batches included); the six Phase 5 questions
(above all whether pilot classes have student devices, and whether to bill boards for bulk
generation); whether to turn on the API's server-side refusal fallbacks (a beta; it brings in a
second model and its price, D-045).

## 7. Starting a new session

Paste something like this (adjust the task):

```
Continue the school app project (Vickrx7/schoolapp) on branch claude/serene-ride-3n2fa1 (draft PR #2, stacked on #1). Read docs/HANDOFF.md, SPEC.md, DECISIONS.md, docs/phase-3.md, docs/phase-4.md and docs/phase-5.md first.

Phases 3 (substitute hand-off), 4 (library core) and 5 (library growth and class mode) are done and CI is green. Next: present the Phase 6 plan and questions to me before building. Never print or commit ANTHROPIC_API_KEY.
```
