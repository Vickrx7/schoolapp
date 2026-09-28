# Lynx École

Plateforme pour les écoles élémentaires catholiques de langue française de l’Ontario: planning,
lesson tracking, differentiated texts with AI and (next) substitute hand-off, built for teachers
first.

- Product brief: [`SPEC.md`](SPEC.md)
- Decisions and assumptions: [`DECISIONS.md`](DECISIONS.md)
- Phase notes, demo scripts and what to test with teachers: [`docs/phase-1.md`](docs/phase-1.md),
  [`docs/phase-2.md`](docs/phase-2.md)
- What the AI sees (for privacy reviews): [`docs/ai-data-flow.md`](docs/ai-data-flow.md)

## Repository layout

```
apps/
  web/            Next.js app (App Router, PWA). UI text in apps/web/messages/{fr-CA,en-CA}.json
  worker/         Background jobs, event outbox dispatcher and AI jobs (graphile-worker, Postgres only)
  admin/          CLI to onboard boards, schools and staff (invite-only accounts)
packages/
  ai/             AI service: privacy layer, providers (Claude, fake), runner, evaluation set
  domain/         Business logic: school days, rotation days, next lesson, roster cleaning, validation
  db/             Generated database types
  integrations/   Adapter interfaces + mocks: PA/bells, access control, intercoms, video, SMS/voice
  config/         Environment variable schema (Zod)
prompts/          Versioned AI system prompts (prompts/<feature>/<version>.md)
supabase/
  migrations/     SQL schema, RLS policies and database functions
  tests/          pgTAP tests (RLS, audit, alerts, planner)
  seed.sql        Fictional demo board, school, staff, classes and lessons
  templates/      Login email (French)
tools/
  lite-stack/     Docker-free local Supabase-compatible stack (fallback)
  gen-db-types.ts Database type generator (no Docker needed)
```

## Requirements

- Node.js 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`)
- Docker, for the Supabase CLI. No Docker? Use the lite stack (below).

## Getting started

```bash
pnpm install
cp .env.example apps/web/.env.local

# Start Postgres, Auth, the API and the mail catcher, apply migrations and load demo data
pnpm db:start            # = supabase start (first run downloads Docker images)
pnpm db:reset            # re-apply migrations + seed at any time

pnpm dev                 # web app on http://localhost:3000
pnpm dev:worker          # background worker and AI jobs (separate terminal; reads apps/web/.env.local)
```

Sign in with a demo account (listed in `supabase/seed.sql`), for example
`isabelle.tremblay@demo.lynx.test`. The 6-digit code arrives in the local mail catcher at
<http://127.0.0.1:54324>.

### Without Docker

```bash
tools/lite-stack/stack.sh reset   # downloads binaries once, creates the DB, migrates, seeds
tools/lite-stack/stack.sh status  # URLs and keys (same as `supabase start`)
```

Same ports and keys as the Supabase CLI, so the same `.env.local` works. See
[`tools/lite-stack/README.md`](tools/lite-stack/README.md).

## Commands

| Command                                        | What it does                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:worker`                 | Run the web app / the worker                                                      |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | Code quality                                                                      |
| `pnpm test`                                    | Unit tests (domain logic, config, integrations, alert encryption)                 |
| `pnpm test:db`                                 | pgTAP database tests (RLS, audit, alerts, planner) via `supabase test db`         |
| `pnpm test:int`                                | Integration tests that need a database (`DATABASE_URL`)                           |
| `pnpm test:e2e`                                | Playwright end-to-end tests (needs the stack running and a built app)             |
| `pnpm db:types` / `pnpm db:types:direct`       | Regenerate `packages/db/src/database.types.ts`                                    |
| `pnpm admin <command>`                         | Onboard boards, schools and staff; AI budgets and usage (`apps/admin/src/cli.ts`) |
| `pnpm ai:eval [--provider fake] [--yes]`       | Run the AI evaluation set (Claude costs about $1; `fake` is free)                 |

## Configuration

Everything is configured with environment variables, documented in [`.env.example`](.env.example).
Board- and school-level options (schedule type, Anglais start grade, alerts on/off, language levels,
modules...) are stored in the database (DECISIONS.md, D-003).

## Privacy in one paragraph

Students are stored by first name or nickname only. Safety/medical alerts are encrypted by the server,
readable only by the class team and the school's direction, hidden on screen until revealed, and every
read is audited. Row Level Security protects every table; logged-out requests get nothing. AI is off
per school until the principal turns it on, and nothing personal is sent to the AI provider: names
become markers and personal details block the request ([`docs/ai-data-flow.md`](docs/ai-data-flow.md)).
Details in `DECISIONS.md` (D-012 to D-019, D-037 to D-043); `PRIVACY.md` comes in a later phase.
