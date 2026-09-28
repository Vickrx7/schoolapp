# Handoff

Written 2026-09-28 by the session that built Phases 1 and 2 (branch `claude/nifty-fermat-8hhl1l`),
for the session continuing in the "School app" environment. Read `SPEC.md` and `DECISIONS.md` first;
this file covers what they don't: the conversation with Mike, the current state, how to run things
in these containers, and what's next.

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

**Branch and PR.** Everything is on `claude/nifty-fermat-8hhl1l`, in draft PR
[Vickrx7/schoolapp#1](https://github.com/Vickrx7/schoolapp/pull/1) (Phases 1 and 2). CI is green
on `715de79` (the handoff commit) and on every commit before it. No reviews or review comments;
Mike hasn't merged it. The new session's own branch is
different (`claude/serene-ride-3n2fa1`), so it cannot push to PR #1 unless Mike allows it. Simplest:
Mike merges PR #1 into `main` once he's happy, then new work branches from `main`. Otherwise, base
the new branch on `claude/nifty-fermat-8hhl1l` and open a PR on top of it.

**Commits:**

| Commit    | What                                                                                        |
| --------- | ------------------------------------------------------------------------------------------- |
| `b9fb620` | Phase 1: schema (48 tables), RLS, planner, today view, worker, admin CLI, lite stack        |
| `c427445` | Security review fixes (open redirect, deactivated users, parents, audit gaps, scope checks) |
| `9dca5be` | CI: push builds on `main` only                                                              |
| `42c142b` | English interface and language toggle                                                       |
| `0d99491` | Email sign-in fix on the Supabase CLI stack (`[auth.email] enable_signup` must be true)     |
| `3af4da0` | Phase 2: AI service (jobs, privacy layer, budgets, evaluation set)                          |
| `b859fc6` | Phase 2: « Texte différencié » screens and the principal's AI switch                        |
| `14762db` | CI race fix in the AI e2e test; class pages guard a missing class                           |
| `715de79` | This handoff note and the promo video sources (`marketing/promo/`)                          |

**Verified (locally and in CI):** 113 unit tests, 217 pgTAP tests, 7 integration tests, 13
Playwright tests (desktop + phone), lint, typecheck, format, generated DB types up to date.

**Not verified:** nothing has been sent to the real Claude API yet. The Anthropic path
(`packages/ai/src/providers.ts`: `messages.create` with `output_config.format` from
`zodOutputFormat`, effort `medium`, no `thinking` param, `max_tokens` 16 000) is untested live.
Everything runs on the fake provider. That's the first thing to do (section 6).

**Half-built:** nothing is half-built in code. Tables for Phases 3–6 exist (substitutes, library,
class mode) with RLS and tests, but no screens.

**Other deliverables:**

- **Promo video:** a 60 s stop-motion commercial (English, Kokoro voice `af_heart`) and a 67 s French
  version (voice `ff_siwis`, which has a France-French accent). Both MP4s were sent to Mike in the
  chat. Their sources are now in `marketing/promo/` (rebuild steps in its README; models, venv and
  videos are git-ignored).
- **Screenshots:** the promo's app screenshots (Phase 1 screens, fictional demo data) are kept in
  `marketing/promo/screens/`. The Phase 2 screenshots sent to Mike in the chat were only in the old
  container and are gone; retake them from the running app if needed.

**Watching.** The old session is still subscribed to PR #1 events and has a one-off check-in
scheduled around 22:07 UTC today. If you take over the PR, tell Mike so only one session drives it.

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
pnpm test:int                              # integration (needs DATABASE_URL)
pnpm db:types:direct                       # regenerate types (needs DATABASE_URL, else it tries :5432)

pnpm --filter @lynx/web build
(cd apps/web && nohup pnpm start --port 3000 > /tmp/next.log 2>&1 &)
(cd apps/worker && AI_PROVIDER=fake AI_FAKE_DELAY_MS=300 nohup pnpm start > /tmp/worker.log 2>&1 &)
cd apps/web && PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
  E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test
```

Demo logins are in `supabase/seed.sql` (e.g. `isabelle.tremblay@demo.lynx.test`, principal
`sophie.lavoie@demo.lynx.test`). The 6-digit code arrives in Mailpit: `http://127.0.0.1:54324`.

**Quirks that cost time:**

- **Keep the e2e worker on the fake provider.** With `AI_PROVIDER=anthropic` and a key set, the
  browser tests would call (and pay for) the real API.
- **Restart the worker after changing `packages/ai`.** `pnpm start` runs tsx without watch;
  `pnpm dev:worker` watches and reads `apps/web/.env.local`.
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
  egress policy. Read CI failures from the job logs.
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
  `NEXT_PUBLIC_APP_NAME`, `ALERTS_ENCRYPTION_KEYS` (a dev-only key is included).
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

1. **Real-API evaluation.** Run `pnpm ai:eval --yes` (10 fictional cases, about $1; the report is
   written to `packages/ai/eval-results/`, which is git-ignored, so send it to Mike). Check that the
   provider code works on Opus 5.5 (structured output, effort, `max_tokens` with thinking), then
   review the French. If the prompt needs changes, propose them to Mike first. Once he approves,
   add `prompts/differentiate/v2.md` and bump `promptVersion`; never edit a version that has been
   used.
2. **Get PR #1 reviewed and merged** (see branch note in section 2).
3. **Hosted beta**, once Mike agrees and provides the accounts. Present a short plan first. It
   covers:
   - a Supabase project in Canada Central;
   - web and worker hosting in a Canadian region;
   - real SMTP for login codes;
   - secrets;
   - a zero-data-retention request to Anthropic.

   This pulls part of Phase 6 (`DEPLOYMENT.md`) forward.

4. **Name.** Once chosen: check availability, then rename `NEXT_PUBLIC_APP_NAME`, the icon, the
   login email template and the promo.
5. **Phase 3 (substitute hand-off).** Present a short plan and questions to Mike before building.

**Known issues and risks:**

- **Real API untested** (above).
- **The preview under-reports replacements.** It de-identifies with the names the teacher can see;
  the worker uses the whole school roster before sending.
- **Unknown names** (a parent's, say) only get caught by the teacher at the preview.
- **Historical figures** who share a student's first name get replaced, then restored.
- **The budget is a soft limit**, checked before each request.
- **Fake-provider costs count toward budgets** in development.
- **`ConfirmButton` is always red**, even for « Activer l'IA » (cosmetic).
- **Other e2e tests could hit the pre-hydration click issue** on a slow CI runner.
- **Stale test count:** `docs/phase-1.md` still says 159 pgTAP tests (now 217).
- **Deleting a personal level fails** ("in use") if a saved text has a version for it; turning it
  off works.

**Waiting on Mike:** the product name; the hosted beta accounts; the zero-data-retention request;
OK on the budget pooling nuance; whether the France-French promo voice is fine; go-ahead for the
Phase 3 plan.

## 7. The paste message for the new session (verbatim)

```
Continue the school app project (Vickrx7/schoolapp) on branch claude/nifty-fermat-8hhl1l. Draft PR #1 has Phases 1 and 2. Read SPEC.md, DECISIONS.md and docs/phase-2.md first.

Task: test Phase 2 against the real Claude API. ANTHROPIC_API_KEY is set in this environment. Never print it or commit it.
1. Run `pnpm install`, then `pnpm ai:eval --yes` (10 fictional texts, about $1). Send me the report and a short summary: how many checks passed, cost per request, and how natural the Canadian French reads, quoting anything that sounds European, anglicized, or too hard for its level.
2. If the API call fails, tell me the exact error before trying anything else.
3. Don't change the prompt or code yet: propose changes first.
```

An earlier version (before the API-credential route failed) said the key was "set up as an API
credential for api.anthropic.com, sent as the `x-api-key` header" and to use a placeholder key if
the SDK needed one. That no longer applies: the key is meant to be a plain environment variable now
(check that it is set before running the evaluation).
