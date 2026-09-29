# Handoff

Written 2026-09-28 by the session that built Phases 1 and 2 (branch `claude/nifty-fermat-8hhl1l`);
updated 2026-09-29 by the session that built Phase 3 (branch `claude/serene-ride-3n2fa1`). Read
`SPEC.md` and `DECISIONS.md` first; this file covers what they don't: the conversation with Mike,
the current state, how to run things in these containers, and what's next. Phase notes:
`docs/phase-1.md`, `docs/phase-2.md`, `docs/phase-3.md`.

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

**The name.** "Lynx École" is a placeholder (`NEXT_PUBLIC_APP_NAME`). Mike is open to anything and
"so far likes something with Tableau". I flagged that "Tableau" alone is a big Salesforce software
brand and suggested **« Au tableau! »** (also: Présent!, Tableau noir, Mon Tableau, Cartable,
Ardoise). No availability or trademark check has been done yet.

## 2. Current state

**Branches and PRs.**

- [Vickrx7/schoolapp#1](https://github.com/Vickrx7/schoolapp/pull/1) (draft, branch
  `claude/nifty-fermat-8hhl1l`): Phases 1 and 2. Not merged; no reviews.
- [Vickrx7/schoolapp#2](https://github.com/Vickrx7/schoolapp/pull/2) (draft, branch
  `claude/serene-ride-3n2fa1`, stacked on #1): the Phase 2 hardening and Phase 3. Once #1 is
  merged, retarget #2 to `main`. Phases 4 and 5 are planned to land on the same PR.

**Commits on #2:**

| Commit    | What                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| `9bba837` | Phase 2 hardening: privacy layer, AI limits, the « Différencier » screens (41 fixes)  |
| `25f9659` | Phase 3 groundwork: the plan builder (`packages/domain`) and the database behind it   |
| `f6a6816` | Merge of the fact-checked handoff note from PR #1's branch                            |
| `16cc8fa` | Absence form, absence page, plan review and editing, Fiche, worker refresh            |
| `e46a56f` | Codes, the substitute portal, the office and direction board                          |
| `9aa32d8` | CI prints the page snapshot of a failed browser test                                  |
| `36c5b91` | Office account kept in French for the browser tests (CI fix)                          |
| `21f9ba6` | The substitute's report, the teacher's confirmation, PDFs                             |
| `edd830b` | Phase 3b: « Consignes détaillées (IA) » and the students' activity sheets             |
| (latest)  | Phase 3 hardening (26 review findings) and the Phase 3 docs, decisions D-047 to D-060 |

**Verified (locally, from an empty database, and in CI on each pushed commit):** 407 unit tests,
609 pgTAP tests, 34 integration tests, 43 Playwright tests (desktop and phone, axe on every
Phase 3 page), lint, typecheck, format, generated DB types up to date, web build.

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

**Not verified:** nothing has been sent to the real Claude API (neither « Texte différencié » nor
« Consignes détaillées »): `ANTHROPIC_API_KEY` is not set in this environment. No hosted
deployment exists; the reverse proxy and the portal role's password are deployment steps
written in `docs/phase-3.md`.

**Half-built:** nothing. Phase 4 (library core) has not started; its tables exist (Phase 1).

**Other deliverables:**

- **Promo video:** a 60 s stop-motion commercial (English, Kokoro voice `af_heart`) and a 67 s
  French version (voice `ff_siwis`, which has a France-French accent). Sources in
  `marketing/promo/` (rebuild steps in its README; models, venv and videos are git-ignored). The
  sick-day plan is labelled « Bientôt » there: it now exists.
- **Screenshots:** Phase 1 screens in `marketing/promo/screens/`. None of Phases 2 and 3 are kept;
  retake them from the running app if needed.

## 3. How to run it (in these containers)

Docker doesn't work here (image pulls are blocked: Docker Hub 429, ECR/GHCR blobs 403), so use the
**lite stack**, which runs the same Supabase pieces as plain binaries on the same ports and keys
(`tools/lite-stack/README.md`). CI uses the real Supabase CLI.

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
- **Lite stack vs CLI drift found so far:**
  - `[auth.email] enable_signup = false` turns email login off entirely in the CLI (fixed in
    `supabase/config.toml`; the lite stack now reads it).
  - The lite stack used to re-grant default table privileges on every start (fixed in
    `bootstrap.sql`).
  - New tables must `revoke all ... from anon, authenticated` explicitly.
  - `supabase/tests/00_schema_invariants.test.sql` catches most of this.
- **Network:** GitHub Actions artifact downloads (`*.blob.core.windows.net`) are blocked by the
  egress policy. Read CI failures from the job logs: a failed browser test prints its page
  snapshot there (`e2e/failure-context-reporter.ts`).
- **The portal role survives resets.** `lynx_sub_portal` is a cluster role: `stack.sh reset`
  drops the database, not the role, so migrations create it only if missing and the seed sets its
  local password again. `pnpm test:int` also needs `SUB_PORTAL_DATABASE_URL` (in `.env.example`).
- **Migrations are applied once.** The lite stack does not re-apply an edited migration: after
  editing one that is not committed yet, `stack.sh reset`. Never edit a committed migration; add
  a new one (the latest is `20261003100000_substitute_hardening.sql`, pgTAP file `14`).
- **Phase 3 browser tests** need the worker (`AI_PROVIDER=fake`) for the refresh and AI
  scenarios, move code windows around the real clock (`e2e/db.ts` `openCodeWindow`) and clean up
  after themselves; `e2e/mobile.spec.ts` briefly gives Isabelle a vice-principal role.
- **Deletes:** `rm -rf *` style commands are refused by a safety check. Use explicit paths.
- **Next warning:** "next start does not work with output: standalone" is harmless in tests. The
  standalone server is at `apps/web/.next/standalone/apps/web/server.js` (monorepo tracing root);
  there is no production or Docker setup yet (Phase 6, D-029).

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

- **Web:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_BASE_URL`,
  `NEXT_PUBLIC_APP_NAME`, `ALERTS_ENCRYPTION_KEYS` (a dev-only key is included), and for the
  substitute portal `SUB_PORTAL_DATABASE_URL` (local-only password), `SUB_CODE_HMAC_KEYS`
  (dev-only key), `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` (production needs an appending reverse
  proxy; `docs/phase-3.md`). The README has the full table.
- **Admin CLI:** `SUPABASE_SERVICE_ROLE_KEY`.
- **Worker:** `DATABASE_URL`, `WORKER_CONCURRENCY`, `OUTBOX_BATCH_SIZE`, `INTEGRATIONS_MODE`,
  `LOG_EVENTS`, `AI_PROVIDER` (`none` | `fake` | `anthropic`), `AI_MODEL` (default
  `claude-opus-5-5`), `AI_EFFORT` (default `medium`), `AI_JOB_RETENTION_DAYS` (default 30).
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

1. **Show Mike Phase 3** with a short summary and the three questions in `docs/phase-3.md` (we
   built on the recommended answers: office prints plans with first names, substitutes see alerts
   on screen, AI instructions are optional with a preview). Update PR #2's description.
2. **Real-API evaluation**, once `ANTHROPIC_API_KEY` is set and Mike agrees: `pnpm ai:eval --yes`
   (11 cases, about $1.60) and `pnpm ai:eval --feature sub_plan --yes` (11 cases, about $2).
   Reports go to `packages/ai/eval-results/` (git-ignored): send them to Mike. Propose prompt
   changes first; never edit a used prompt version (add `v2`).
3. **Get PRs #1 and #2 reviewed and merged.**
4. **Test with a real teacher and a real substitute** (`docs/phase-3.md`, « What to test »).
5. **Phase 4 (library core).** Present a short plan and questions to Mike before building.
   Library items then fill the gaps in substitute plans (D-052).
6. **Hosted beta**, when Mike provides the accounts: Supabase in Canada Central, web and worker
   in a Canadian region, real SMTP, secrets (including the portal role's password and the code
   keys), a reverse proxy set up as `docs/phase-3.md` says, and a zero-data-retention request to
   Anthropic. This pulls part of Phase 6 (`DEPLOYMENT.md`) forward.
7. **Name.** Once chosen: check availability, then rename `NEXT_PUBLIC_APP_NAME`, the icon, the
   login email template and the promo.

**Known issues and risks:**

- **Real API untested** (above).
- **Substitute access codes are bearer credentials.** Whoever holds a code (the office staff
  member who issued it included) sees the day's plan and alerts. It is audited with the issuer's
  id and role; the Phase 6 audit viewer should flag office-issued sessions (D-056).
- **Throttling needs the reverse proxy.** Reached directly, a client chooses its address and
  drops its device cookie; the 50-bit code and the global cap of 300 failures a minute remain
  (D-051).
- **The worker must run** for plans to follow later changes; publishing does not need it.
  Monitoring comes in Phase 6.
- **Plans and structured reports are kept without a purge job yet** (1 year proposed; Phase 6).
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

**Waiting on Mike:** the three Phase 3 questions; the product name; the hosted beta accounts; the
zero-data-retention request; OK on the budget pooling nuance; whether the France-French promo
voice is fine; the real-API evaluation go-ahead; the Phase 4 plan; whether to turn on the API's
server-side refusal fallbacks (a beta; it brings in a second model and its price, D-045).

## 7. Starting a new session

Paste something like this (adjust the task):

```
Continue the school app project (Vickrx7/schoolapp) on branch claude/serene-ride-3n2fa1 (draft PR #2, stacked on #1). Read docs/HANDOFF.md, SPEC.md, DECISIONS.md and docs/phase-3.md first.

Phase 3 (substitute hand-off) is done and CI is green. Next: present the Phase 4 (library core) plan and questions to me before building. Never print or commit ANTHROPIC_API_KEY.
```
