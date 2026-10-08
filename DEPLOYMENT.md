# Deployment

How to install and run the app (« Lynx École » for now) in production, in one of two ways:

- **Hosted by IP Lynx, in Canada:** Supabase Pro in Canada (Central) for the database and the
  sign-in service, plus one Canadian server running the app with Docker Compose.
- **Board-hosted:** the same Docker Compose files on the board's own server, with a minimal
  self-hosted Supabase next to it.

Both run the same two images, built from a tagged checkout and configured only through the
environment. `PRIVACY.md` describes what each component holds; the decisions behind this document
are D-111 to D-115, D-119, D-121 and D-122 in `DECISIONS.md`. Every `docker compose` command below runs from
`deploy/docker`.

**Status (release 0.6):** the board-hosted install is tested in CI on every change (the
`docker-smoke` job builds both images, starts the install behind Caddy, signs in, prints a PDF,
takes a backup and runs the upgrade script), and backups are restored into an empty database in CI
(`backup-restore`). The hosted install has not been set up yet: hosted Supabase, Amazon SES, the S3
upload and external monitors are untested, which is why section 3 ends with go-live gates.

## Contents

1. Overview
2. Configuration reference
3. Hosted by IP Lynx (Canada)
4. Board-hosted
5. Behind a load balancer
6. Backups and restore
7. Upgrades
8. Secrets and rotation
9. Monitoring and logs
10. Rules for operators
11. Troubleshooting
12. Migration file names

## 1. Overview

```
                Hosted by IP Lynx                                   Board-hosted
  ┌─────────────── server (AWS ca-central-1) ──────────┐   ┌──────────── the board's server ─────────────┐
  │ proxy (Caddy) :80 :443 ◀── the only public entry    │   │ proxy (Caddy) :80 :443 ◀── the only public   │
  │   └▶ web (lynx-web) :3000                           │   │   └▶ web (lynx-web)                          │
  │ worker (lynx-app)                                   │   │ worker (lynx-app)                            │
  │ migrate (lynx-app), runs once at every `up`         │   │ migrate (lynx-app)                           │
  │ backup, admin (lynx-app), run on demand             │   │ backup, admin (lynx-app)                     │
  └──────────┬──────────────────────────────────────────┘   │ api-gateway (Caddy, internal :8000)          │
             │ HTTPS and Postgres over TLS                   │   ├▶ auth (Supabase Auth)                    │
  ┌──────────▼───────── Supabase Pro, ca-central-1 ─────┐   │   └▶ rest (PostgREST)                        │
  │ database (Postgres 17), Auth, API                   │   │ db (supabase/postgres 17, volume db-data)    │
  └─────────────────────────────────────────────────────┘   └──────────────────────────────────────────────┘
```

| Service                             | Image                            | What it does                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy`                             | Caddy 2.11.4                     | HTTPS (Let's Encrypt, or Caddy's own authority), HSTS, filtered access logs; the only public port                                                                                            |
| `web`                               | `lynx-web` (built here)          | The Next.js server (standalone build), as user `node`                                                                                                                                        |
| `worker`                            | `lynx-app` (built here)          | Background jobs: plan refresh, AI, staff accounts, nightly clean-up, heartbeat; `/healthz` on 8081                                                                                           |
| `migrate`                           | `lynx-app`                       | At every `up`: a backup if migrations are pending on a database with data, then the migrations, the portal logins and PostgREST's schema reload. Web and worker start only after it succeeds |
| `backup`                            | `lynx-app` (profile `tools`)     | `docker compose run --rm backup`: an encrypted backup (section 6)                                                                                                                            |
| `admin`                             | `lynx-app` (profile `tools`)     | `docker compose run --rm admin <command>`: the operator's command line (`pnpm admin`)                                                                                                        |
| `db`, `auth`, `rest`, `api-gateway` | pinned Supabase images           | Board-hosted only (`compose.supabase.yml`); on the internal network, never published                                                                                                         |
| `mailpit`                           | Mailpit (profile `mail-catcher`) | CI only: catches the sign-in e-mails                                                                                                                                                         |

- **Images.** `lynx-web` and `lynx-app` are built from the checkout (`docker compose build`) and
  never pulled (`pull_policy: never`): do not expect `docker compose pull` to update them. The
  other images are pinned by digest in `compose.yml` and `compose.supabase.yml`, the only place
  production image versions are set (`docker compose config --images` lists them).
- **No setting is built into an image.** The web build fails if a build-time address reaches its
  output. Telemetry is off in both images (`NEXT_TELEMETRY_DISABLED`, `DO_NOT_TRACK`,
  `SUPABASE_TELEMETRY_DISABLED`).
- **Each service receives only its own settings** from `.env`, through Compose interpolation;
  there is no shared `env_file`. The service key never reaches the web server.
- **Which files Compose uses** is in `.env` (`COMPOSE_FILE`, written by `generate-secrets.mjs`):
  `compose.yml` hosted, `compose.yml:compose.supabase.yml` board-hosted. So a board's IT types
  plain `docker compose …` commands.

## 2. Configuration reference

`node generate-secrets.mjs --hosted|--board` writes `.env` with the values below that need one,
generating the secrets and leaving blank what you fill in; the others have defaults (add a line
to `.env` to change one). "Generated" means the script made it; never reuse a value from another
install or from this repository.

**proxy**

| Variable     | Secret | Default | What it is                                                                               |
| ------------ | ------ | ------- | ---------------------------------------------------------------------------------------- |
| `APP_DOMAIN` | no     | none    | The app's address, for example `app.example.ca` (DNS A and AAAA records to the server)   |
| `ACME_EMAIL` | no     | none    | Let's Encrypt's contact for certificate notices                                          |
| `CADDY_TLS`  | no     | `acme`  | `acme` (Let's Encrypt) or `internal` (Caddy's own authority: tests, air-gapped installs) |

**web**

| Variable                                 | Secret       | Default                          | What it is                                                                                                                       |
| ---------------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                           | no           | board: `http://api-gateway:8000` | Supabase's API address. Hosted: `https://<project-ref>.supabase.co`                                                              |
| `SUPABASE_ANON_KEY`                      | keep private | board: generated                 | The anonymous API key (row level security protects everything; the browser never sees it)                                        |
| `APP_BASE_URL`                           | no           | `https://${APP_DOMAIN}`          | Set by `compose.yml`. Must be the exact public origin: browser error reports and class devices from any other origin are refused |
| `APP_NAME`                               | no           | `Lynx École`                     | The product name shown in the app                                                                                                |
| `APP_RELEASE`                            | no           | the build's                      | Built into the image from `APP_RELEASE` at `docker compose build`                                                                |
| `SUPPORT_EMAIL`, `PRIVACY_CONTACT_EMAIL` | no           | empty                            | Shown in the app and on « Confidentialité » when set                                                                             |
| `ALERTS_ENCRYPTION_KEYS`                 | **yes**      | generated                        | `1:<base64 of 32 bytes>`: encrypts alerts and report notes. Losing it makes them unreadable                                      |
| `SUB_PORTAL_DATABASE_URL`                | **yes**      | generated (board)                | Database login of the substitute portal's role, `lynx_sub_portal`                                                                |
| `SUB_CODE_HMAC_KEYS`                     | **yes**      | generated                        | `1:<base64>`: hashes substitute codes                                                                                            |
| `CLASS_PORTAL_DATABASE_URL`              | **yes**      | generated (board)                | Database login of the class devices' role, `lynx_class_portal`                                                                   |
| `CLASS_PORTAL_HMAC_KEY`                  | **yes**      | generated                        | base64 of 32 bytes: the devices' throttle keys                                                                                   |
| `CLIENT_IP_HEADER`                       | no           | `x-forwarded-for`                | Set by `compose.yml`                                                                                                             |
| `TRUSTED_PROXY_HOPS`                     | no           | `1`                              | Proxies in front of the web server that append the client's address: 1 (Caddy), 2 behind a load balancer (section 5)             |

**worker**

| Variable                                              | Secret       | Default            | What it is                                                                                                                                                     |
| ----------------------------------------------------- | ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | **yes**      | board: generated   | The database as its owner (`postgres`), in session mode (the worker listens for events)                                                                        |
| `SUPABASE_URL`                                        | no           | as web             | For Auth's admin API (staff accounts)                                                                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                           | **yes**      | board: generated   | Creates, bans and unbans staff sign-in accounts. Without it, invitations say « Les invitations ne sont pas configurées sur ce serveur. »                       |
| `AI_PROVIDER`                                         | no           | `none`             | `none`, `fake` (answers made locally, for tests) or `anthropic`                                                                                                |
| `ANTHROPIC_API_KEY`                                   | **yes**      | empty              | With `AI_PROVIDER=anthropic`                                                                                                                                   |
| `AI_MODEL`, `AI_EFFORT`                               | no           | the app's defaults | `DECISIONS.md` D-041. `AI_MODEL` must have a price in `packages/ai/src/pricing.ts`; for any other model, set both `AI_PRICE_*`, or the worker refuses to start |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` | no           | empty              | US dollars per million tokens, for a model the app has no price for (worker and admin)                                                                         |
| `BULK_MAX_RUN_USD`                                    | no           | 100                | The most one bulk generation run may cost (at most 1,000)                                                                                                      |
| `WORKER_CONCURRENCY`                                  | no           | 4                  | Jobs at once                                                                                                                                                   |
| `WORKER_HEALTH_PORT`                                  | no           | 8081               | Set by `compose.yml`: the container's health check                                                                                                             |
| `HEARTBEAT_URL_WORKER`                                | keep private | empty              | A monitor's URL, pinged after each successful heartbeat (every minute); it receives no data                                                                    |

**migrate** (also takes the `backup` settings, because it backs up before migrating)

| Variable                                       | Secret  | Default          | What it is                                                                                     |
| ---------------------------------------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `MIGRATIONS_DATABASE_URL`                      | **yes** | board: generated | The database as its owner, in session mode                                                     |
| `SUB_PORTAL_PASSWORD`, `CLASS_PORTAL_PASSWORD` | **yes** | generated        | The portal roles' passwords, set at every `up` as SCRAM verifiers (never in a log)             |
| `MIGRATE_WITHOUT_BACKUP`                       | no      | empty            | `yes`: migrate a database with data without a backup first. Only when you hold a recent backup |

**backup**

| Variable                                                 | Secret       | Default          | What it is                                                                                                                             |
| -------------------------------------------------------- | ------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL`                                    | **yes**      | board: generated | The database as its owner, in session mode                                                                                             |
| `BACKUP_AGE_RECIPIENT`                                   | no           | empty            | The **public** key from `age-keygen` (`age1…`); several, space-separated                                                               |
| `BACKUP_SIGNING_KEY`                                     | **yes**      | generated        | Signs every backup (64 hex digits). Keep a copy with the age key (3.7)                                                                 |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`                   | no           | empty            | Optional copy to S3                                                                                                                    |
| `BACKUP_S3_ENDPOINT`                                     | no           | empty            | Empty: Amazon S3. Otherwise any S3-compatible storage (MinIO, Ceph, a NAS), such as `https://s3.conseil.ca`, with path-style addresses |
| `BACKUP_S3_REGION`                                       | no           | `ca-central-1`   | The region the signature names (S3-compatible storage often expects `us-east-1`)                                                       |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | **yes**      | empty            | A key that may only put objects in the bucket                                                                                          |
| `BACKUP_KEEP_DAYS`                                       | no           | 30               | Local backups older than this are deleted                                                                                              |
| `HEARTBEAT_URL_BACKUP`                                   | keep private | empty            | A monitor's URL, pinged after each successful backup                                                                                   |

**admin:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_PRICE_*`,
`BULK_MAX_RUN_USD`, as above, and its own setting below. Its replies are shown to the operator and
never kept in the journal.

| Variable        | Secret | Default                                                   | What it is                                                                                                                                                                                                                                |
| --------------- | ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPERATOR_NAME` | no     | `IP Lynx`; board: `Service informatique du conseil` (set) | Who the board's audit log names for each entry the admin commands write (D-147): the team or person who runs them. 1 to 80 characters, no control characters; an invalid one stops every command. Entries written before keep « IP Lynx » |

**Self-hosted Supabase** (board-hosted only)

| Variable                                                        | Secret  | Default       | What it is                                                                                                                                      |
| --------------------------------------------------------------- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                             | **yes** | generated     | The database owner's password; also Auth's and PostgREST's logins at first start                                                                |
| `JWT_SECRET`                                                    | **yes** | generated     | Signs the API keys and sessions. Changing it changes both keys and signs everyone out                                                           |
| `SMTP_HOST`, `SMTP_PORT`                                        | no      | port 587      | The board's mail relay                                                                                                                          |
| `SMTP_USER`, `SMTP_PASS`                                        | **yes** | empty         | Only over STARTTLS: Supabase Auth sends a login only on an encrypted connection                                                                 |
| `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME`                          | no      | `Lynx École`  | The sign-in e-mail's sender                                                                                                                     |
| `AUTH_EMAIL_MAX_FREQUENCY`                                      | no      | `60s`         | One code per address per interval                                                                                                               |
| `AUTH_EMAIL_RATE_LIMIT`                                         | no      | 100           | Sign-in e-mails per hour, for the whole install                                                                                                 |
| `AUTH_RATE_LIMIT_OTP`, `AUTH_RATE_LIMIT_VERIFY`                 | no      | 60, 60        | Code requests and code checks per client address per 5 minutes (a school shares one)                                                            |
| `GOTRUE_SESSIONS_TIMEBOX`, `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT` | no      | `168h`, `12h` | Sessions end after 7 days, or 12 hours without activity                                                                                         |
| `AUTH_LOG_LEVEL`                                                | no      | `warn`        | Auth's own log: warnings and errors. `info` writes the address of every sign-in to the journal: set it only while investigating, then remove it |

**Compose itself:** `COMPOSE_FILE` (which files), `LOG_DRIVER` (`journald`), and in CI only
`COMPOSE_PROFILES=mail-catcher`.

**Database addresses inside Compose** end with `?sslmode=disable`: the self-hosted database is on
Compose's internal network without TLS, and the Supabase CLI in `migrate` refuses a non-local
database without TLS unless told. Never publish the `db` port.

## 3. Hosted by IP Lynx (Canada)

### 3.1 Accounts

- Supabase, Pro plan (about 25 USD a month), organization owned by IP Lynx.
- AWS account owned by IP Lynx: Lightsail (about 24 USD a month), SES and S3 in `ca-central-1`.
- A domain, and an uptime monitor that receives no personal data.
- An Anthropic API account with a spending limit, if AI is on.

Monthly cost before AI: about 55 USD (Supabase 25, Lightsail 24, S3 and SES about 2, domain about 2).

### 3.2 Supabase project

1. Create the project in **Canada (Central)**, Pro plan. Keep the database password in the
   operator's password manager. Only named operators are members of the organization, each with
   two-factor sign-in: the dashboard's table and SQL editors read every row.
2. Database settings: turn on **SSL enforcement**; add **network restrictions** so only the
   server's IPv4 and IPv6 addresses can connect.
3. Auth settings:
   - Site URL `https://<APP_DOMAIN>`; redirect allow list `https://<APP_DOMAIN>/**`.
   - "Allow new users to sign up": **off**. Email provider: on. OTP length 6, expiry 3600 seconds.
   - SMTP: `email-smtp.ca-central-1.amazonaws.com`, port 587, with an SES SMTP user; the sending
     domain verified in SES with SPF, DKIM and DMARC.
   - Email rate limit: at least 60 an hour.
   - The magic link template: the content of `supabase/templates/magic_link.html`, subject
     « Votre code de connexion ».
   - Sessions: time-box 7 days, inactivity timeout 12 hours (Pro plan settings).
4. Note the project's API URL, its anonymous key and its service role key (Project Settings,
   API), and the **session pooler** connection string (Connect, Session pooler). The session pooler
   (port 5432) is needed: the worker listens for notifications and `pg_dump` needs a session. Once
   a board's data is in, opening it in the dashboard counts as access (section 10).
5. Download the project's **SSL certificate** (Database settings). Supabase signs its database
   certificates with its own authority.

The new API key format (`sb_publishable_…`, `sb_secret_…`) has not been tested with this app; use
the anonymous and service role keys.

### 3.3 Server

1. Lightsail, `ca-central-1`, Ubuntu 24.04, 4 GB, with IPv4 and IPv6. SSH only from known
   addresses; unattended upgrades on.
2. Docker Engine and the Compose plugin from Docker's repository, and Node.js 22, only to run
   `generate-secrets.mjs` once (3.4; Ubuntu has no `node`).
3. The journal: `deploy/host/journald-lynx.conf` to `/etc/systemd/journald.conf.d/lynx.conf`, then
   `systemctl restart systemd-journald` (containers' logs kept 14 days, a new file each day, 1 GB
   at most).
4. The checkout: `git clone https://github.com/Vickrx7/schoolapp /opt/lynx-ecole`, then
   `git -C /opt/lynx-ecole checkout v0.6.0`. IP Lynx tags each release before it is installed
   (`git tag v0.6.0`, then `git push origin v0.6.0`); no release is tagged yet.

### 3.4 Settings

```bash
cd /opt/lynx-ecole/deploy/docker
node generate-secrets.mjs --hosted      # writes .env (mode 0600) and lists the blanks to fill in
```

Without Node on the server, run the script in a container instead:

```bash
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/w" -w /w node:22.23.3-bookworm-slim \
  node generate-secrets.mjs --hosted
```

Never write `.env` with a shell redirection (`> .env`): the script refuses to overwrite a file and
creates it with mode 0600 itself. Fill in:

- `APP_DOMAIN`, `ACME_EMAIL`, `SUPPORT_EMAIL`, `PRIVACY_CONTACT_EMAIL`.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (web), `SUPABASE_SERVICE_ROLE_KEY` (worker and admin).
- Save Supabase's certificate as `deploy/docker/certs/supabase-ca.crt` (mounted read-only at
  `/certs` in web, worker, migrate and backup; the folder's files are never committed).
- `DATABASE_URL`, `MIGRATIONS_DATABASE_URL` and `BACKUP_DATABASE_URL`: the session pooler string
  (user `postgres.<project-ref>`, the database password), ending with
  `?sslmode=verify-full&sslrootcert=/certs/supabase-ca.crt`.
- `SUB_PORTAL_DATABASE_URL` and `CLASS_PORTAL_DATABASE_URL`: the script wrote them with the users
  `lynx_sub_portal.<project-ref>` and `lynx_class_portal.<project-ref>` and their generated
  passwords; replace `<project-ref>`, check the pooler host against the dashboard's, and add the
  same `sslmode` and `sslrootcert` parameters.
- `BACKUP_AGE_RECIPIENT` and the `BACKUP_S3_*` values (3.7).
- `HEARTBEAT_URL_WORKER`, `HEARTBEAT_URL_BACKUP` (3.9), and the AI settings (3.10).

The worker and the portals use node-postgres, which treats `sslmode=require` as full verification:
without the certificate they cannot connect. Checking these connections is part of the staging
drill (3.11).

### 3.5 Start

```bash
APP_RELEASE=0.6.0 docker compose build
docker compose up -d --wait             # migrate first (the database is empty: no backup), then web, worker, proxy
```

Point the domain's A and AAAA records at the server; Caddy obtains the certificate. Then
`curl -fs https://<APP_DOMAIN>/api/health/ready` answers `{"status":"ok"}`.

### 3.6 The first board

Create the board, record the access in its log (section 10), then create its schools, its school
year and its first administrator:

```bash
docker compose run --rm admin create-board --name "Conseil scolaire …" --slug csc-exemple --short-name "CSC Exemple"
docker compose run --rm admin log-operator-access --board csc-exemple --reason support
docker compose run --rm admin create-school --board csc-exemple --name "École élémentaire catholique …" \
  --slug saint-exemple --short-name "É.É.C. Saint-Exemple" [--cycle 6]
docker compose run --rm admin create-year --board csc-exemple --name 2026-2027 --starts 2026-09-01 --ends 2027-06-30
docker compose run --rm admin invite --email admin@conseil.ca --name "Nom Prénom" --role board_admin --board csc-exemple
```

The board admin then signs in, accepts the pilot terms and invites the staff in « Conseil »
(`docs/PILOT.md`). Schools, modules, AI budgets and retention stay with the operator
(`pnpm admin set-module`, `set-ai-budget`, `set-ai-board`, `set-retention`).

### 3.7 Backups

1. On the operator's workstation (never the server): `age-keygen -o lynx-backup.key`. Put the
   printed public key (`age1…`) in `BACKUP_AGE_RECIPIENT`. Keep the key file offline, with a second
   copy in a vault. Without it no backup can be read.
2. Copy `BACKUP_SIGNING_KEY` from `.env` (`generate-secrets.mjs` made it) into a file next to the
   age key, `lynx-backup-signing.key`, and into the vault. Every backup is signed with it, and
   `restore.sh` refuses a backup whose signature it cannot check: the age public key on the server
   lets anyone make an encrypted file, the signature says this install made it, unchanged. Never
   store the signing key with the backups (not in the bucket).
3. An S3 bucket in `ca-central-1`: versioning on; a lifecycle rule that expires current objects
   after 30 days and **noncurrent versions after 1 day**; public access blocked.
4. An IAM user whose only permission is `s3:PutObject` on that bucket; its keys go in
   `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY`.
5. The nightly job: `deploy/host/lynx-backup.cron` to `/etc/cron.d/lynx-backup` (06:30 UTC, which
   is 01:30 or 02:30 in Toronto), with the checkout's path.
6. Try it once: `docker compose run --rm backup`, then « État du système » shows the backup.

Supabase's own daily backups (7 days on Pro) are the first way back; ours are the copy outside
Supabase.

### 3.8 Starter content

A new install has no curriculum, Catholic references or library resources (the demo's come from
`supabase/seed.sql`, which never runs in production). Without them, browsing by attente and the
plans' « Moment de foi » are empty.

```bash
# Curriculum (paraphrased samples, flagged « À vérifier »; a dry run without --apply):
docker compose run --rm admin import-curriculum --file /repo/content/curriculum/fra-2023-3e.json --apply
# The board's Catholic references (docs/catholic-references.md), mounted into the container:
docker compose run --rm -v "$PWD/references.json:/tmp/references.json:ro" admin import-references \
  --board csc-exemple --file /tmp/references.json --apply
# Library resources from a content pack (docs/content-packs.md), mounted into the container:
docker compose run --rm -v "$PWD/pack.json:/tmp/pack.json:ro" admin import-pack --board csc-exemple \
  --file /tmp/pack.json --apply [--approve --approver conseillere@conseil.ca]
```

Official curriculum text needs permission first (`--confirm-licence`, D-070); so do texts copied
from a Bible or liturgical translation, published prayers or the Catholic graduate expectations
(D-030). Each import is a dry run without `--apply`; record the access first (section 10). The
board's references come from its own file: `/repo/content/catholic-references/sample.json` holds
fictional examples to try the command, not texts for a board. Load the references before a
content pack whose resources name them.

### 3.9 External monitoring

- An HTTP check of `https://<APP_DOMAIN>/api/health/ready` every minute, from outside the server.
- A heartbeat check for `HEARTBEAT_URL_WORKER` with a 5-minute grace period, and one for
  `HEARTBEAT_URL_BACKUP` with a 26-hour grace period.
- Alerts go to one named on-call person (not Mike): urgent when the web check fails 06:00 to 17:00
  on school days; next morning for the worker (publishing plans still works without it) or a missed
  backup.
- The monitor receives URLs and pings only. « État du système » tells the board admins about a
  problem but notifies nobody.

### 3.10 AI

`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env` (the worker only). Set a monthly spending
limit in Anthropic's console and send the zero-data-retention request before real data (not sent
yet; until it is in place, Anthropic keeps API inputs and outputs for a limited period under its
commercial terms). AI stays off at each school until its principal turns it on, and budgets are
the operator's (`pnpm admin set-ai-budget`). A model other than the default needs a price
(`AI_PRICE_*`, section 2).

### 3.11 Go-live gates

Before real student data:

- A restore drill into a **staging** Supabase project (section 6), which also checks the worker's
  and the portals' TLS connections.
- Supabase's written answer: where backups and all platform logs are kept, and where TLS to
  `*.supabase.co` terminates.
- The zero-data-retention request sent to Anthropic, and its answer.
- An Ontario privacy lawyer's review of the pilot terms, the notice and the minimum retention
  periods.
- `docs/PILOT.md` § 1 done.

## 4. Board-hosted

**Server:** 4 vCPU, 8 GB of memory, 100 GB SSD; Linux with Docker 24 or later and the Compose
plugin, and Node.js 22 to run `generate-secrets.mjs` once (or the container command of 3.3). Only
ports 80 and 443 open to the users' networks. The release's tag must exist (3.3).

**Setup:**

```bash
git clone https://github.com/Vickrx7/schoolapp /opt/lynx-ecole && cd /opt/lynx-ecole
git checkout v0.6.0 && cd deploy/docker
node generate-secrets.mjs --board          # .env (mode 0600) with COMPOSE_FILE=compose.yml:compose.supabase.yml
# fill in APP_DOMAIN, ACME_EMAIL, SMTP_HOST, SMTP_ADMIN_EMAIL (and SMTP_USER/SMTP_PASS over STARTTLS),
# SUPPORT_EMAIL, PRIVACY_CONTACT_EMAIL, BACKUP_AGE_RECIPIENT; check OPERATOR_NAME (your IT team's name)
APP_RELEASE=0.6.0 docker compose build
docker compose up -d --wait
docker compose run --rm admin create-board …     # then create-school, create-year,
docker compose run --rm admin invite --role board_admin …   # as in 3.6
```

- **The operator's name:** the board's audit log names `OPERATOR_NAME` for every entry an admin
  command writes (access records, settings, modules, deleted accounts). The script writes
  `Service informatique du conseil`; put the name of the team or person who runs the commands.
  Unset, entries read « IP Lynx », which does not run this install (section 2).
- **The journal:** `deploy/host/journald-lynx.conf` as in 3.3. The database writes no statements
  and no error details there (`compose.supabase.yml`), so its first start no longer logs its own
  `ALTER USER supabase_admin WITH PASSWORD …`, and Auth writes warnings and errors only; the
  `docker-smoke` CI job checks that the journal holds no e-mail address and no password. An
  install first started without these settings logged that statement: run
  `sudo journalctl --rotate && sudo journalctl --vacuum-time=1s` once (this removes the server's
  older logs too).
- **Mail relay:** Supabase Auth sends a login to the relay only over STARTTLS (or to localhost).
  A relay without TLS must accept mail from the server without a login.
- **Backups:** as 3.7, with the cron line from `deploy/host`. The nightly file stays in the
  `backups` volume on this server, next to the database: copy it off the server, to the board's
  S3-compatible storage (`BACKUP_S3_ENDPOINT`), to Amazon S3, or with the board's own tools (the
  file is encrypted and signed).
- **Starter content:** as 3.8.
- **Outbound connections:** the mail relay; `api.anthropic.com` only if AI is on; Let's Encrypt
  (unless `CADDY_TLS=internal` or the board's certificates); package and image downloads at build
  time only; the monitors' URLs if set.
- **Air-gapped:** `AI_PROVIDER=none`, `CADDY_TLS=internal` (or the board's certificate in the
  Caddyfile), packs through the command line, and images moved as files:
  `docker save lynx-web lynx-app $(docker compose config --images | grep -v lynx) | gzip > bundle.tgz`
  on a connected machine, then `docker load`.

## 5. Behind a load balancer

The web server reads the client's address from `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS`
proxies from the right; throttling of substitute codes and class devices depends on it.

- Caddy appends the address it sees; with nothing in front, `TRUSTED_PROXY_HOPS=1`.
- Behind a board's load balancer: add the balancer's addresses to Caddy's `trusted_proxies` (a
  `servers` global option in `deploy/docker/Caddyfile`), make the balancer append (never replace)
  `X-Forwarded-For` and keep `Host`, and set `TRUSTED_PROXY_HOPS=2`.
- Reached without a proxy, a client could write its own address: the per-network and per-device
  delays would no longer hold (the code's strength and the global cap of failures still do).
- Staff sign-in (D-121) uses the same address: the app's own limits on wrong codes per network,
  and, board-hosted, Supabase Auth's limits per address, which the web server passes to Auth in
  `X-Lynx-Client-Ip` (`GOTRUE_RATE_LIMIT_HEADER` in `compose.supabase.yml`; Auth is reachable only
  from inside, so no client can set it). When the address cannot be told (`TRUSTED_PROXY_HOPS`
  wrong), neither applies per network: the per-person limits still do.

## 6. Backups and restore

**What a backup is.** `lynx-backup-<UTC time>.tar` in the `backups` volume (and S3 or
S3-compatible storage), holding the data of the `public` and `auth` schemas (without sessions,
sign-in tokens and Auth's log) and a manifest (release, migrations, row counts), both encrypted
with `age`, and a `signature`
(HMAC-SHA256 with `BACKUP_SIGNING_KEY`). The dump is never written unencrypted. Keys and `.env`
are never in a backup.

**Taking one by hand:** `docker compose run --rm backup`.

**Restoring** (on the operator's workstation, which holds the private key, never the server; RPO
24 hours, RTO 4 hours). The workstation needs the PostgreSQL 17 client, `age` and `jq`, and a way
to the database, which is not reachable from outside:

- **Board-hosted:** an SSH tunnel to the `db` container's address on the Compose network. On the
  server, `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' lynx-db-1`
  gives it; on the workstation, `ssh -N -L 5433:<that address>:5432 <operator>@<server>`. The owner
  URL is then `postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5433/postgres`. Close the tunnel
  afterwards; never publish the `db` port.
- **Hosted:** add the workstation's address to the project's network restrictions for the restore
  only, and use the session pooler's URL with `sslmode=verify-full` and Supabase's certificate
  (3.4). Remove the address afterwards.

1. Stop web and worker: `docker compose stop web worker`.
2. Prepare an empty database at the backup's migrations: a fresh install (`up` with a new `db-data`
   volume, board-hosted) or a new Supabase project, then `migrate`.
3. Restore:
   `deploy/backup/restore.sh lynx-backup-….tar --identity lynx-backup.key --signing-key lynx-backup-signing.key --db-url <owner URL>`.
   It checks the signature before decrypting anything and refuses an unsigned or altered backup,
   a manifest whose counts are not tables and numbers, and a dump holding anything but what
   pg_dump writes for data (a psql command or another statement never runs on your machine). It
   checks the migrations, refuses a database that already has a board (unless `--force`), loads
   everything in one transaction (`--single-transaction`, stopping at the first error), bans again
   everyone whose access was removed, compares every table's row count with the manifest, and
   hands recent events back to the worker.
4. Record the access for each board, now that the database (and its audit log) is back:
   `docker compose run --rm admin log-operator-access --board <slug> --reason restore`.
5. Do what it prints: re-apply access removals made after the backup's time (from the board's
   records and the audit log), and tell staff to sign in again (sessions are not restored).
6. Start web and worker (`docker compose up -d --wait`), then check `/api/health/ready` and
   « État du système ».

**Hosted:** restore with Supabase's dashboard first; use our backup when Supabase's is not
available, or for the off-platform copy.

**Monthly drill:** a restore that works is the only proof that backups work. It copies every
board's data, so it is an access like any other:

1. Record the access for each board (`--reason restore`).
2. Restore last night's backup into a throw-away copy: board-hosted, a fresh Compose install on the
   operator's workstation, on an encrypted disk (the same pinned versions as the server, so
   `restore.sh` accepts the backup's Auth migrations); hosted, a staging Supabase project in
   Canada (hosted Auth is newer than any local one). Never the lite stack: its Auth (v2.177.0)
   lacks 21 of the migrations of production's (v2.197.0), so `restore.sh` refuses the backup.
3. Check that `restore.sh` reports every count equal to the manifest.
4. Destroy the copy: `docker compose down -v` (the volumes go too), or delete the staging data.

`docs/HANDOFF.md` § 3 has a local drill with the demo data, for development.

**Keys:** losing `ALERTS_ENCRYPTION_KEYS` makes alerts and report notes unreadable, even from a
backup. Keep a copy with the backup key, offline.

## 7. Upgrades

```bash
cd /opt/lynx-ecole/deploy/docker && ./upgrade.sh v0.6.1
```

It checks out the tag, builds both images, stops web and worker, starts everything again (`migrate`
first, which takes a backup when migrations are pending) and checks that the web server is ready.

- Evenings or weekends only, **never 05:30 to 09:00 on a school day** (absences are reported then).
- Rolling back means the previous tag plus a restore of the backup `migrate` took.
- Security updates of the images come as releases. Every image is pinned by digest (the
  Dockerfile's base, `compose.yml`, `compose.supabase.yml`), so rebuilding without a release
  fetches the same bytes: IP Lynx updates the pinned versions in a release, and the operator
  installs it with `./upgrade.sh <tag>`. IP Lynx plans to review the pinned versions monthly; no
  automation does it yet. The server's own system updates itself (unattended upgrades).
- **Upgrading an install made before backups were signed:** add `BACKUP_SIGNING_KEY`
  (`openssl rand -hex 32`) to `.env` under the backup settings, and copy it next to the age key,
  before the upgrade: `migrate` takes a signed backup, and `backup.sh` refuses to run without the
  key. Older backups have no signature and `restore.sh` refuses them; keep the previous release's
  `restore.sh` for them until they age out (30 days). Board-hosted, also add
  `AUTH_RATE_LIMIT_OTP=60` and `AUTH_RATE_LIMIT_VERIFY=60` (or leave them out: those are the
  defaults).
- Record the access first (`--reason migration`).

## 8. Secrets and rotation

| Secret                                                            | How to rotate                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET` (board-hosted)                                       | Generate a new one, compute new anonymous and service keys (as `generate-secrets.mjs` does), update `.env`, `docker compose up -d`. Everyone signs in again                                                                                                                                                                                          |
| Supabase API keys (hosted)                                        | In Supabase's dashboard, then `.env`, then `docker compose up -d`                                                                                                                                                                                                                                                                                    |
| `ALERTS_ENCRYPTION_KEYS`                                          | Add `2:<new key>` after `1:…` (comma-separated), then `docker compose up -d web` (a restart does not read `.env` again): new text uses the highest version, older text stays readable. Keep version 1 while text encrypted with it exists (there is no re-encryption command, so after a leak, alerts already stored stay readable with the old key) |
| `SUB_CODE_HMAC_KEYS`                                              | Add `2:<new>` next to `1:<old>`, `docker compose up -d web`, remove `1:` a day later (codes last one day), `docker compose up -d web` again. Outside school hours                                                                                                                                                                                    |
| `CLASS_PORTAL_HMAC_KEY`                                           | Replace it, then `docker compose up -d web`, outside class time                                                                                                                                                                                                                                                                                      |
| Portal passwords (`SUB_PORTAL_PASSWORD`, `CLASS_PORTAL_PASSWORD`) | Change them in `.env` and in the two portal URLs, then `docker compose up -d` (`migrate` sets them)                                                                                                                                                                                                                                                  |
| `POSTGRES_PASSWORD` (board-hosted)                                | `docker compose exec db psql -U supabase_admin -d postgres`, then `alter role postgres`, `supabase_admin`, `authenticator` and `supabase_auth_admin` `with password '…'` (the superuser `supabase_admin` too: it got the first password at the first start); update `.env` (and the database URLs); `docker compose up -d`                           |
| SMTP, Anthropic, S3 keys                                          | At the provider, then `.env`, then `docker compose up -d`                                                                                                                                                                                                                                                                                            |
| The backup key                                                    | `age-keygen` a new one, put both public keys in `BACKUP_AGE_RECIPIENT` for 30 days, then only the new one                                                                                                                                                                                                                                            |
| `BACKUP_SIGNING_KEY`                                              | `openssl rand -hex 32` into `.env` and next to the age key; keep the old one with it for 30 days (older backups need it to restore)                                                                                                                                                                                                                  |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## 9. Monitoring and logs

- **Endpoints:** `/api/health` (the web server is up), `/api/health/ready` (Auth, the API and the
  portal databases answer; 503 otherwise, never details). The worker's `/healthz` (port 8081,
  inside Compose) is its container's health check.
- **« État du système »** (« Conseil »): « normal » or « à vérifier » for the worker, the last backup
  and the last clean-up, and when they last ran. No counts.
- **`docker compose run --rm admin status`:** the operator's view with counts (outbox, AI jobs,
  invitations, heartbeats).
- **Logs** go to the server's journal, kept 14 days. The web server and the worker write one JSON
  line per event, scrubbed of personal details (`PRIVACY.md` § 8). Board-hosted, Auth (warnings
  and errors; `AUTH_LOG_LEVEL`) and the database (no statements, errors without their detail)
  write their own lines, which are not scrubbed. The admin command line's replies are never kept.

  ```bash
  journalctl CONTAINER_NAME=lynx-web-1 --since -24h -o cat | jq 'select(.level == "error")'
  journalctl CONTAINER_NAME=lynx-worker-1 --since -1h -o cat
  ```

  An error page shows « Référence : … »; the same value is the `digest` or `ref` field of the
  matching line. A browser that left while a page was loading is an `info` line, not an error.

## 10. Rules for operators

- **Record every access to production data before it happens:**
  `docker compose run --rm admin log-operator-access --board <slug> --reason support|incident|restore|migration`.
  The board's admins read these entries in their audit log. Running a command that reads or
  changes a board's data, connecting to its database, or opening its data in Supabase's dashboard
  (the table or SQL editor) counts as access. After a restore, record it once the database is
  back (section 6).
- The service key and the database password stay on the server and in the operator's password
  manager. Never paste them in a chat, an e-mail or a ticket.
- Only named operators have SSH access; remove an operator's access the day they leave.
- Account deletions and board deletions are done on the board's written request
  (`delete-user`, `delete-board`), and confirmed in writing.
- **Before a board is deleted, export its whole audit log** (every entry, of every audience and
  date; `delete-board` refuses without an export of the last 7 days) and give the file to the
  board's privacy office. It names staff and holds the entries the app shows to nobody: keep it
  off the server and delete your copy once the board has it.

  ```bash
  docker compose run --rm admin log-operator-access --board csc-exemple --reason support
  mkdir -p exports && docker compose run --rm --user "$(id -u):$(id -g)" -v "$PWD/exports:/out" \
    admin export-audit --board csc-exemple --out /out/journal-csc-exemple.csv
  docker compose run --rm admin delete-board --board csc-exemple --confirm csc-exemple --exported --yes
  ```

## 11. Troubleshooting

- **Sign-in codes do not arrive:** check the mail relay or SES (SPF, DKIM, DMARC for the sending
  domain), the rate limit, and the board's mail filtering. A code is valid one hour; Auth sends one
  per address per interval (`AUTH_EMAIL_MAX_FREQUENCY`). Board-hosted, Auth logs a refused e-mail
  as an error; `AUTH_LOG_LEVEL=info` (then `docker compose up -d auth`) shows every request, with
  the addresses, until you remove it again.
- **« Trop de codes erronés » / « Trop de tentatives de connexion »:** the sign-in throttle (D-121):
  five wrong codes need a new code, and limits per address and per network wait for minutes (or,
  after twenty wrong codes in a day, hours). The link in the code's e-mail always works. A whole
  school held back at once means `TRUSTED_PROXY_HOPS` is wrong (section 5).
- **« Les invitations ne sont pas configurées sur ce serveur. »:** the worker lacks
  `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`; its start line says `staffAccounts: off`.
- **Substitutes or class devices are throttled together:** `TRUSTED_PROXY_HOPS` does not match the
  proxies in front (section 5).
- **Browser error reports return 403, class devices cannot answer:** `APP_BASE_URL` is not the
  exact public origin (scheme, host and port).
- **The worker restarts in a loop with "missing migrations":** the database lacks a migration
  shipped in the image (the schema guard); run `docker compose up -d --wait` so `migrate` runs.
- **`/api/health/ready` answers 503:** Auth, the API or a portal database does not answer; the web
  server's log names which check failed.
- **PDFs fail:** the fonts are part of the web image; rebuild it from a clean checkout.
- **Times are off by an hour:** each school has its own time zone (`create-school --timezone`);
  the server's clock should be UTC.

## 12. Migration file names

Once production exists, a new migration's timestamp must be later than the newest file already
applied, or `supabase db push` refuses it. Phases 4 to 6 used future dates (`20261015…` to
`20261201…`), so a new file may need a date later than today. CI checks that every new migration
sorts after those on the base branch (`deploy/ci/check-migration-order.sh`).
