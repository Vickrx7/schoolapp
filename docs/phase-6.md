# Phase 6: pilot readiness (« Prêt pour le projet pilote »)

Decisions: `DECISIONS.md` D-102 to D-122, and the Phase 6 amendments written into D-002, D-004,
D-012, D-013, D-017, D-018, D-029, D-036, D-039, D-040, D-043, D-046, D-055, D-056, D-059, D-064
and D-078. The documents this phase adds: `PRIVACY.md` (for a board's privacy officer),
`DEPLOYMENT.md` (hosted and board-hosted installs), `docs/PILOT.md` (running the pilot, for Mike)
and `docs/demo-script.md` (the board demo, kept true by `apps/web/e2e/demo.spec.ts`).

## What was built

**For principals and vice-principals**

- **« Tableau de bord de la direction »** (`/direction`, their landing page when they do not
  teach), per school: « Absences aujourd'hui » with each plan's status, codes, devices and report
  (the next school day folded below), « Accès aux alertes (7 derniers jours) », « Contributions à la
  banque de ressources » (counts and the 10 latest, credited as on the item page) and « Utilisation
  de l'IA ce mois-ci ». Never a teacher's units, lessons, progress or per-teacher figures.
- **« Journal d'audit »** (`/audit`): the school's entries with filters (period, category, person,
  type), paging, « Historique de cet élément », the badge « Code émis par le secrétariat » on a
  substitute's entry whose code the office issued, and « Télécharger (CSV) », itself logged.

**For board admins: « Conseil »** (`/board`, their landing page)

- « Administration du conseil »: « Pour bien démarrer le conseil » (what is left to set up), « État
  du système » (the background service, the last backup and the last clean-up) and « Conservation
  des données » (the board's retention).
- « Personnel »: everyone with a role in the board (« Accès actif », « Aucune connexion », « Accès
  retiré »), « Inviter une personne » (the worker creates the account; the page gives a French or
  English message to send by e-mail or text; no invitation e-mail leaves our servers), and each
  person's page: add or remove a role, « Retirer l'accès » and « Rétablir l'accès ».
- « Écoles » (contact details and bell times, the AI switch; the rest read only), « Années
  scolaires », « Approbation des ressources » (reviewers), « Utilisation de l'IA » (per school, with
  a CSV), « Commentaires reçus », and the board's « Journal d'audit » (administration and
  approvals only: never sick days, substitute activity or alert reads).
- « Calendrier »: PA days and holidays for the whole board (« Tout le conseil »).

**For teachers**

- **« Bienvenue »** at the first sign-in: five plain privacy points, a link to « Confidentialité et
  conditions », the box to accept the pilot terms, then the display name and how students address
  them. Every page waits for it; newer terms later show a banner that never blocks.
- **« Pour bien commencer »** on « Aujourd'hui » and at `/demarrage`: four steps counted from real
  classes, and « Essayer avec une classe exemple (3e) » or « (5e) »: 20 invented first names, a
  timetable, a Français and a Mathématiques unit of 8 lessons (3 done), marked « Exemple », never in
  a substitute plan, deleted after 60 days.
- **« Commentaires »** at the top of every page (and `/commentaires`): a problem, an idea or a
  question; students' first names are replaced with « [élève] » before it is stored (final
  review).
- « Confidentialité », « Nouveautés » and the version in every page's footer; « Signaler ce
  problème » and « Référence : … » on every error page; a notice 60 days before a class's first
  names are erased.

**For substitutes:** one line on the code screen (« …chaque consultation est enregistrée. ») and
« Confidentialité » in the portal's footer.

**For the operator (IP Lynx, or a board's IT):** `pnpm admin set-retention`, `status`,
`log-operator-access`, `delete-user`, `export-audit` (final review) and `delete-board`; `invite`
and `deactivate` now audited for the board.

**Under the hood**

- The audit log closed to the API and read through one function, with four audiences and labels
  computed per viewer; a guard that refuses free text in new entries.
- AI usage rows private to their author; per-school totals for the direction and board admins.
- Retention: a nightly job deletes what `PRIVACY.md` § 9 lists, per board, within bounds of at
  least a year.
- Scrubbed JSON logs (web server and worker), error references, `/api/health` and
  `/api/health/ready`, the worker's heartbeat and `/healthz`, a Content Security Policy on every
  page.
- Settings read at run time (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_NAME`; the `NEXT_PUBLIC_*`
  names still work as fallbacks).
- Two Docker images, Docker Compose for both installs, `generate-secrets.mjs`, `migrate.sh` (a
  backup first), `upgrade.sh`, encrypted backups and a checked restore, and two more CI jobs
  (`backup-restore`, `docker-smoke`).

### Slices

| Slice    | Commits                                    | What                                                                                                  |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| S0       | `3e3f1bb`                                  | Foundation: D-102 to D-120, shared schema, settings, navigation, stubs                                |
| S1       | `ca21d2c`                                  | Accounts, roles, access, deletions, sample classes, school settings, feedback (database)              |
| S2       | `0d85e15`                                  | Audit viewer, AI usage totals, retention, heartbeats (database, worker, CLI)                          |
| S3a      | `598ee7b`                                  | Scrubbed logs, error references, health checks, security headers                                      |
| S3b      | `8010537`, `bf70481`, `756f435`, `b161445` | Docker images, Compose installs, backups and restores, CI jobs                                        |
| S4       | `4612c53`, `81da4cf`                       | « Conseil » and the worker's staff accounts                                                           |
| S5       | `8a5356a`, `3ba74ac`                       | « Tableau de bord de la direction » and « Journal d'audit »                                           |
| S6       | `2c0abb2`                                  | « Bienvenue », the checklist, the sample class, « Commentaires », « Confidentialité », « Nouveautés » |
| S7       | `76203a4`, `da31b87`                       | These documents, the demo spec, the security review and its fixes                                     |
| Review A | `d460555`, `ae0ca87`, `6915404`, `de7b798` | The final review's code and data fixes                                                                |
| Review B | the latest commits                         | The final review's privacy wording, the whole audit export, the journal                               |

## How to run it

```bash
tools/lite-stack/stack.sh reset
pnpm dev                      # or: pnpm --filter @lynx/web build && (cd apps/web && pnpm start)
pnpm dev:worker               # needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for invitations
```

Demo logins (codes in Mailpit, `http://127.0.0.1:54324`): `sophie.lavoie@demo.lynx.test`
(principal: « Direction », « Journal d'audit »), `nathalie.roy@demo.lynx.test` (board admin:
« Conseil »), `isabelle.tremblay@demo.lynx.test` (teacher), `julie.bergeron@demo.lynx.test`
(office). The demo accounts have accepted the pilot terms; an invited account goes through
« Bienvenue ». The board demo: `docs/demo-script.md`.

New operator commands:

```bash
pnpm admin status                                             # heartbeats, outbox, AI jobs, invitations
pnpm admin set-retention --board csc-demo --audit-days 1095    # within the bounds; prints what the board keeps
pnpm admin log-operator-access --board csc-demo --reason support   # before any access to a board's data
pnpm admin deactivate --email prof@conseil.ca                  # as « Retirer l'accès », audited for the board
pnpm admin delete-user --email prof@conseil.ca --yes           # after the access was removed
pnpm admin export-audit --board csc-exemple --out journal.csv    # the whole log, for the board
pnpm admin delete-board --board csc-exemple --confirm csc-exemple --exported --yes   # within 7 days of it
```

Settings this phase adds or renames (the README's table has them all):

| Variable                                        | Where       | What it is                                                                            |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_NAME` | web         | Read at run time; the old `NEXT_PUBLIC_*` names are fallbacks (D-113)                 |
| `APP_RELEASE`                                   | web, worker | The release, in the footer, `/api/health`, logs and heartbeats                        |
| `SUPPORT_EMAIL`, `PRIVACY_CONTACT_EMAIL`        | web         | Shown in the app and on « Confidentialité »                                           |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`     | worker      | Staff accounts (create, ban, unban); without them invitations say « non configurées » |
| `WORKER_HEALTH_PORT`, `HEARTBEAT_URL_WORKER`    | worker      | The worker's `/healthz`, and an external monitor pinged every minute                  |
| Deployment settings                             | Compose     | `DEPLOYMENT.md` § 2                                                                   |

## Data inventory (additions)

| Data                                                                      | Holds                                                                                                             | Who reads it                                     | Kept                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `staff_invitations`                                                       | e-mail, name, title, role, school, status, error code, inviter                                                    | the board's admins                               | pending 14 days; processed 90 days        |
| `users.terms_version`, `terms_accepted_at`, `onboarding_dismissed_at`     | the pilot terms accepted, when; the checklist hidden                                                              | the person only (`my_onboarding_state`)          | with the account                          |
| `classes.sample_owner_id`, `students_purged_at`                           | a sample class's owner; when a class's students were purged                                                       | the class team                                   | with the class                            |
| `classes.students_purge_notice_on`                                        | the first night the year-end notice showed (review fix C4)                                                        | the class team                                   | with the class                            |
| `sign_in_attempts`                                                        | keyed hashes of an address and a network, kind, time (D-121)                                                      | nobody through the API                           | 2 days                                    |
| `app.install_secrets`                                                     | the install's random key for those hashes                                                                         | the database owner only; never in backups        | with the install                          |
| `feedback`                                                                | kind, message, page template, error reference, release, device, language                                          | the board's admins (sender only if they agreed)  | 365 days                                  |
| `audit_action_catalog`, `system_heartbeats`                               | who may read each action; the last run of each service with counts                                                | nobody through the API; board admins see a state | catalogue fixed; heartbeats replaced      |
| Auth's own tables                                                         | e-mails, sign-in times, sessions (the app server's address, never a person's), Auth's log (no IP address)         | nobody through the app                           | sessions 7 days or 12 h idle; log 90 days |
| Logs (web server, worker, proxy; board-hosted also Auth and the database) | the app's: scrubbed JSON lines, masked IP addresses; Auth's and the database's: warnings and errors, not scrubbed | the operator                                     | 14 days                                   |
| Backups                                                                   | the data of `public` and `auth` (no sessions, tokens or Auth log), encrypted                                      | nobody without the offline key                   | 30 days                                   |

`PRIVACY.md` § 4 has the whole inventory.

## Security review (slice S7)

The plan's checklist, plus every item the slices left for the review. Fixed items have tests.

**Checked, no change needed**

- **Grants on every function Phase 6 created or replaced (50):** the signed-in role runs only the
  functions its screens use; the operator's functions (`operator_*`, `log_operator_access`,
  `app.retention_limits`) run with the service role only; the worker's steps and the helpers that
  take a user run for the database owner only. `app.mark_sample_class` is executable by signed-in
  users on purpose (the invoker `create_sample_class` calls it) and accepts only a class the caller
  created in the last 10 minutes, without students.
- **`list_audit_entries` is the only reader of `audit_log`:** no API role can select from the
  table; the other functions that read it are triggers, the nightly job and the operator's
  `delete-board`.
- **No e-mail or free text in audit rows or events:** the guard trigger refuses free-text keys and
  long strings in every new row; the local database's 402 audit rows have no string over 40
  characters and no `@`; every event carries ids, dates and short codes only.
- **No `NEXT_PUBLIC_`** in `apps/web/src` (ESLint rule and CI check).
- **`.env` is never logged** by the scripts (`migrate.sh`, `backup.sh`, `restore.sh`, `upgrade.sh`
  print messages and counts only); `generate-secrets.mjs` creates `.env` with mode 0600 and never
  overwrites it; a backup holds only the database's data (and `.dockerignore` keeps every `.env`
  out of the images); each Compose service gets only its own variables, with no shared `env_file`.
- **The console guard's 250 ms hold** (Next prints an error after `onRequestError` logged it): held
  lines are flushed when the process exits; each lives 250 ms, so the set stays small.
- **PDF routes without the Content Security Policy** (Chrome checks a PDF against its own
  `object-src`): the PDFs are made by the server from stored content, sent `no-store` with
  `nosniff`, and contain no script.
- **`/api/client-error`'s rate limit** is in memory per server process, keyed by the client address
  (so it depends on `TRUSTED_PROXY_HOPS`, `DEPLOYMENT.md` § 5), with at most 10,000 addresses held;
  it only limits log noise.
- **Telemetry:** off in both images and in `migrate.sh` (`NEXT_TELEMETRY_DISABLED`, `DO_NOT_TRACK`,
  `SUPABASE_TELEMETRY_DISABLED`, the update notifiers).

**Found and fixed**

1. **Admin commands put e-mail addresses in URLs** (`invite`, `deactivate`, `set-library-reviewer`,
   `import-pack --approver`, through PostgREST filters, which the hosted gateway's logs record).
   They now find the account with `operator_account_id` (the address in the request body) and use
   ids afterwards. A unit test runs each command against a recording fake of the API; an ESLint
   rule now refuses any PostgREST filter on an address or a name, and pattern or full-text filters,
   in every app and package (pinned by a unit test).
2. **`pnpm admin invite`** created accounts without the `authenticated` role (the worker already set
   it); it sets it now, also when it restores an account.
3. **`pnpm admin deactivate` and the restoring `invite` were not audited**, and skipped the plan
   refresh and the worker's ban sync. They now go through `operator_set_staff_active`, which does
   what « Retirer l'accès » does, with IP Lynx as the actor the board sees (pgTAP 31).
4. **Colleagues could read each other's terms acceptance time** (about when someone first signed
   in, which « Personnel » deliberately never shows) and checklist state, through the table-wide
   `select` grant. The grant is now a column list, and a person reads their own state through
   `my_onboarding_state()` (pgTAP 31).
5. **« IP Lynx a été avisé »** on « État du système » promised a notification nothing sends (and on a
   board's own servers IP Lynx is not the operator). It now says « Un problème a été détecté :
   signalez-le à la personne qui gère le serveur. »
6. **The privacy notice** said IP Lynx accesses data « seulement pour le soutien »; operators also
   access it for an incident, a restore or an upgrade (the four reasons `log-operator-access`
   records). The notice now names them; the terms are unchanged.
7. **Hosted database connections over TLS:** node-postgres treats `sslmode=require` as full
   verification, and Supabase signs its database certificates with its own authority, so the
   worker and the portals could not have connected. Compose now mounts `deploy/docker/certs`
   read-only, and `DEPLOYMENT.md` § 3.4 gives the URLs (`sslrootcert`).
8. **The proxy's access log** kept the words searched in « Ressources » (`?q=`) and the `Referer`
   header (the previous page's address); both are dropped now.
9. **Log noise:** a browser leaving a page while it streamed was logged as an error (« The
   destination stream closed early. »), about 25 lines per full browser test run; it is an `info`
   line now. A vice-principal whose role was removed while « Suppléances » loaded got an error
   page and an error line; it is « Page introuvable » now. A substitute plan's refresh failed and
   was retried 10 times when its absence was deleted mid-build; it ends quietly now (integration
   test).
10. **« Aujourd'hui »** drew a cancelled or replaced period (a mass) at 70 % opacity, which failed
    axe's contrast check every Friday; it is a dashed, flat card now, with full-contrast text.
11. **The CSP check** now covers the projector (« Présenter à la classe »), the public privacy page
    and the Phase 6 teacher pages, besides the app, the substitute portal and class devices.
12. **The scrubber on real error texts:** captured from the local stack (PostgreSQL's DETAIL lines
    with an address or a whole failing row, PostgREST and Auth error bodies, a sign-in link with
    its token, a validation error with its input) and kept as a test
    (`packages/observability/src/real-samples.test.ts`); all passed without a change. The server
    logs of the last full browser run held no address and no seeded first name.
13. **The projector's countdown** moved its bar every 250 ms with a 300 ms transition, so the page
    never settled and the accessibility check after starting a timer could only pass on a slow
    machine; each move now ends before the next starts.

**Not fixed, and why**

- **The self-hosted database logs its own first-start statements** into the journal (kept 14
  days), its `ALTER USER supabase_admin WITH PASSWORD …` included. The statement comes from the
  `supabase/postgres` image's own start-up script, which we do not control and cannot test without
  Docker here. `DEPLOYMENT.md` § 4 has the operator clear the journal after the first start; the
  journal is readable only by administrators, who already hold `.env`. (Fixed in the final review,
  round B: statement logging is off, and CI checks the journal.)
- **The operator's recording of support access is a rule, not a lock:** whoever holds the service
  key can read data without `log-operator-access` first. `PRIVACY.md` § 7 says so.
- **`operator_delete_staff_account` and the class-delete trigger repeat `app.purge_sub_plan`'s
  steps.** They behave the same (same order, same audit row); the class trigger also records the
  class. Rewriting committed definer functions for tidiness was not worth the risk now; a later
  cleanup can make both call `app.purge_sub_plan`.
- **A first name typed in free text cannot be scrubbed from a log.** Errors never carry what people
  typed, browsers send a hash of their message, and `scrubError` never reads an error's other
  fields; logs are kept 14 days on the server.
- **Hosted Supabase is untested** (keys, pooler, TLS, Auth settings, the Auth log purge); the
  staging drill is a go-live gate (`DEPLOYMENT.md` § 3.11).

**For the final Phase 6 review:** `x-lynx-path` handling in `proxy.ts` (it overwrites a client's
value); that `app.sample_class_setup` cannot be set by an API caller; feedback that holds
sender-confirmed first names (board admins only, 365 days); the end-of-year first-name notice
(domain unit tests only, not in a browser test); « Signaler ce problème » on an error page (its
`/commentaires?ref=` target is tested).

## Final review (2026-10-02)

Four reviewers read the whole phase against the running app and the code: correctness (4
findings, C1 to C4), security (7, S1 to S7), product and UX (19, U1 to U19) and the documents (18,
D1 to D18). Four were serious: the year-end purge deleting current plans (C1), staff sign-in codes
not throttled on a board's own servers (S1), privacy texts promising that the AI never sees a name
(D1), and "every log line is scrubbed" while the sign-in service and the database wrote e-mail
addresses to the journal (D2). Round A fixed the code and data; round B made the documents and the
texts teachers accept say exactly what the app does. Everything was fixed except what "What
remains" lists.

### Round A: code and data

Migration `20261201090500_phase6_review_fixes.sql`, pgTAP `32_phase6_review_fixes`.

- **C1 (high) — the class purge deleted current plans.** A teacher who kept last year's class had
  its blocks in every new plan; a year after that class's year, the nightly purge deleted her
  upcoming plans, released ones included, every night. Plans now cover only classes whose school
  year includes the day (`sub_plan_sources`, the builder's `classesOn`, « Aujourd'hui »), and the
  purge deletes only plans of the class's own year (a later plan loses only its link). pgTAP 32 and
  `retention.int.test.ts` (the reviewer's case, two nights).
- **C2 — the worker could deadlock its pool on invitations.** One connection per job; the pool
  fails a checkout after 30 s. `staff.int.test.ts`: four existing-account invitations at once on a
  pool sized as the worker's.
- **C3 — an unban that failed after an invitation completed was never retried.** A delivery for a
  `ready` invitation syncs its account again. `staff.int.test.ts` (Auth fails the first unban).
- **C4 — a year moved into the past purged that night without notice.** The first night of the
  notice is recorded, and the purge waits 60 days after it (`classPurgeDate`). pgTAP 32, unit tests.
- **S1 (high) — staff sign-in codes were not throttled board-hosted.** The app's own throttle
  (D-121) and Auth's per-address limits through `X-Lynx-Client-Ip`. pgTAP 32 and
  `e2e/sign-in.spec.ts` (five wrong codes lock the code; a new code works).
- **S2 — feedback stored students' first names.** They are replaced with « [élève] » before
  storing, for office staff too. Unit tests, pgTAP 32, `feedback.spec.ts`.
- **S3 — `delete-user` left the person's invitations.** Deleted, by account and address. pgTAP 32.
- **S4 — `restore.sh` ran whatever a forged backup held.** Backups are signed
  (`BACKUP_SIGNING_KEY`); the restore checks the signature first, the manifest's counts and every
  dump line, and loads in one transaction. `deploy/ci/restore-refusals.sh` in the backup CI job.
- **S5 — an invitation completed after its inviter lost access.** Cancelled by the system. pgTAP 32.
- **S6 — `?next=` keeps its query string** across sign-in and « Bienvenue ». Not changed: it only
  ever leads to a page of the app, and every page checks access again; a crafted link can only
  open a filtered view.
- **S7 — on hosted Supabase, Auth's per-address limits count the web server's address** for
  everyone. Covered by S1 for the guessing risk (the app's throttle counts per person and per
  client network); Supabase's own limits stay install-wide there until hosted Supabase can be
  given the client's address. Watch for 429s at the morning peak.
- **UX (U2–U13, U15–U19):** « Pour bien commencer » reachable from « Profil » after « Masquer »,
  with a toast saying so; neutral staff statuses (« Accès actif », « Aucune connexion », « Personne
  désignée… »); board tabs scroll to the current section on phones, with an edge cue; « État du
  système » says « pas encore … prévu » on install day; « 1er » for the first of a month
  everywhere; the sample class explained once; « Commentaires » named on phones; the direction's
  phone bar has five items; « Plus tard » and « Ce qui a changé » for newer terms (D-110); « Retour
  à l'accueil » on not-found pages, which are pages with a heading, as the error page is (with its
  tab title); « Journal d'audit » wording (no duplicated issuer, « aucune alerte », « Type de
  personne », « Historique de cette personne ») and its place in the navigation; the invitation's
  title is a list (Mme, M., Mx), the role editor's fields full width; release months that are not in
  the future; the feedback page's error advice only with a reference, the board's feedback times
  as the log writes them; French spacing (`tools/i18n/typography.mjs`, checked by a unit test) and
  curly quotes in the English « Conseil »; the privacy page leads back to the substitute portal.

### Round B: privacy wording

Migration `20261201090600_phase6_board_audit_export.sql`, pgTAP `33_board_audit_export`. The texts
teachers accept changed, so the terms are now `2026-10-pilote-2`: everyone signed in before sees
the banner and « Ce qui a changé » (D-110).

- **D1 (high) and U1: "the AI never sees a name".** The app replaces the names it knows (the
  students and staff of the teacher's schools); a parent's or a sibling's name goes out unless the
  teacher removes it at the preview. `PRIVACY.md`, the README, the demo script, the AI annex,
  « Bienvenue » and the notice now say exactly that, and « Bienvenue » says the data is stored in
  Canada and only the text sent to the AI is processed in the United States (« La protection des
  renseignements et le projet pilote »). A unit test pins the limit; the onboarding and demo
  browser tests check the new wording.
- **D2 (high): the journal.** Board-hosted, Auth now logs warnings and errors only
  (`AUTH_LOG_LEVEL`, `warn`), and the database no statements and no error details. Checked on the
  lite stack (at `info`, Auth wrote the address on 3 of 12 lines of one sign-in; at `warn`, on none;
  PostgreSQL's DETAIL line with an address and the logged `create role … password` both vanish),
  and in CI: the `docker-smoke` job now fails if the install's journal holds an e-mail address or a
  password statement. The first-start password line goes with it. The admin CLI's replies are
  no longer kept in the journal, and the journal starts a new file each day so its 14 days hold.
  `PRIVACY.md` § 8 says what is still not scrubbed.
- **D3: hosting stated as done.** Supabase's backups have their own row "to confirm in writing",
  the zero-data-retention request is "to be sent" (and what Anthropic keeps meanwhile is said),
  and the demo's hosting slide says "planned".
- **D4, D5: IP Lynx's access.** The documents name the Supabase dashboard as access, recording
  as a rule, and IP Lynx as a possible pilot board administrator, with what that role sees and the
  advice that a board employee also hold it. Feedback readers are the same in the terms, the
  dialog and `PRIVACY.md`.
- **D6: the end of a contract.** `pnpm admin export-audit` writes the board's whole log (every
  audience and date) for its privacy office, and is itself logged; `delete-board` refuses unless
  such an export was made in the last 7 days (D-122). pgTAP 33, unit tests, and the Docker CI job
  runs the refusal, the export and the deletion in the image.
- **D7, D8: restores.** `DEPLOYMENT.md` § 6 gives the route to the database (an SSH tunnel, or
  the workstation's address allowed for the restore), records the access after the restore, and
  makes the monthly drill a recorded access into a throw-away copy that is destroyed afterwards
  (never the lite stack: its Auth lacks 21 of production's migrations, checked).
- **D9: monthly rebuilds** did nothing (pinned images). Security updates now come as releases.
- **D10, key rotation:** `docker compose up -d web` (a restart does not read `.env`), and the
  database password rotation includes `supabase_admin`.
- **D11, backups on the board's storage:** `BACKUP_S3_ENDPOINT` (any S3-compatible storage). The
  backup CI job uploads through a stand-in that checks the AWS signature, so the upload is tested
  for the first time.
- **D12, D13, installation:** Node.js or a container for `generate-secrets.mjs`, the release tag
  to create, "the values that need one"; `AI_PRICE_*` reach the worker and the admin CLI, so a
  model without a built-in price can be used.
- **D14 to D18, smaller corrections:** kept class results (counts only) below a year, alerts as a
  recommendation, the audit guard's real reach, retention « par défaut » in the notice, sessions and
  Auth's log (the app server's address, never a person's: checked), the « Moment de foi » cookie
  and drafts, the breach steps and the alert key, the AI annex's retention, the decisions table,
  this file's question 4, and `docs/HANDOFF.md` (commits, stale sentences, the wrapped list).
- **U14: « écrivez à IP Lynx ».** The board's pages say « la personne qui gère le serveur », and
  the deletion link appears only with `SUPPORT_EMAIL`.

### What remains, and why

- **A name the app does not know** (a parent's, a sibling's) still goes to the AI if the teacher
  leaves it in. Recognizing every unknown name would block most ordinary texts; the teacher's
  check at the preview is the control, and every text now says so (question 6 below).
- **Board-hosted logs of Auth and the database are not scrubbed.** They now hold no address in
  normal use, but an error can still quote a value it refused, and a refused e-mail can name its
  address. They are kept 14 days, readable by the server's administrators.
- **Hosted Supabase keeps its own logs and backups**, whose location and contents we cannot set;
  Supabase's written answer is a go-live gate (`DEPLOYMENT.md` § 3.11).
- **The operator's recording of access is a rule, not a lock** (the security review's "Not
  fixed"). The operator's entries now name whoever runs the command line: `OPERATOR_NAME` (IP Lynx
  by default; on a board's servers, its IT) is recorded with each entry (D-147). Entries written
  before keep « IP Lynx ».
- **S6 (`?next=` keeps its query string)** is unchanged, and **S7 (Supabase's per-address limits
  count the web server's address, hosted)** stays covered by the app's own throttle (round A).
- **Security updates of the images** arrive only when IP Lynx updates the pinned versions; no
  automation does it yet.
- **Untested here:** hosted Supabase, Amazon SES and S3 themselves (the upload is tested against a
  stand-in), the real AI API, iPads.

## Deviations from the plan

- **No `versions.env`:** the images are pinned by digest in `compose.yml` and
  `compose.supabase.yml`, so a board's IT never needs `--env-file` (S3b, D-114).
- **« Bienvenue » is one page with one « Commencer »** (the plan had two steps).
- **A sample class never shows in the direction's « Journal d'audit »** (`sample_class.deleted` is
  for the operator only; its class team is not logged; D-109).
- **Removing a teacher role** warns that the person's classes there stay out of reach, without the
  plan's « Ses 2 classes » (board admins cannot read classes).
- **The audit viewer's longest period is 365 days**, not 366 (a daylight-saving change would push
  366 local days past the database's bound by an hour).
- **The CLI's `deactivate` and the restoring `invite` are audited** (the plan left them as they were).
- **The demo spec reports the absence for the next school day** rather than today, so it passes at
  any hour; the script tells the presenter to use today.
- **No command loaded Catholic references** into a new install in Phase 6 (the demo's come from
  the seed). `pnpm admin import-references` came after it (D-146, `docs/catholic-references.md`);
  `DEPLOYMENT.md` § 3.8 says how IP Lynx loads a pilot board's references.
- **Payment collection, SSO, a web operator console, a public demo site, a self-hosted error
  tracker and a penetration test** are not in Phase 6, as planned.

## Tests

| Kind                     |                      Count | What Phase 6 added                                                                                                                                                                                                                      |
| ------------------------ | -------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`pnpm test`)       |                      1,302 | scrubbing (vectors and real error texts), logs, retention dates, sample classes, invitation messages, CSV, audit filters and labels, the audit catalogue against every migration, navigation, CLI commands and their URLs, ESLint rules |
| Database (pgTAP)         |                      1,715 | files 27 to 33: accounts, audit viewer, retention, onboarding and feedback, the security review, the final review's fixes, the whole audit export                                                                                       |
| Integration (`test:int`) | 93 (and 3 after a restore) | staff accounts against the stack's real Auth, retention, health, the schema guard, restore re-dispatch, a plan refresh whose absence is deleted mid-build                                                                               |
| Browser (Playwright)     |                        130 | « Conseil » (desktop and phone), « Direction », « Journal d'audit » (desktop and phone), onboarding (desktop and phone), feedback, legal pages, operations, the Docker smoke test, the demo                                             |

CI runs all of them on every push, plus `backup-restore` (a backup restored into an empty
PostgreSQL 17 database, then the pgTAP suite on it) and `docker-smoke` (the board-hosted install
from both images, with a browser smoke test, a backup and the upgrade script).

## Known limits

- **No hosted install yet.** Hosted Supabase, Amazon SES, the S3 upload and the external monitors
  are untested; `DEPLOYMENT.md` § 3.11 lists the go-live gates.
- **The real AI API is still untested** (the key is not set here); every AI feature runs on the
  fake provider in tests.
- **Local versions differ from production:** the lite stack runs PostgreSQL 16 and an older Auth;
  CI runs PostgreSQL 17 and the versions Compose pins.
- **iPads are not tested** (no WebKit here); phones and tablets are Chromium.
- **No Catholic references or curriculum ship with a new install:** the operator loads them from
  the board's files (`import-references`, `import-curriculum`; `DEPLOYMENT.md` § 3.8).
- **Retention minimums** (a year, and the 60-day deletion of substitutes' notes) wait for the
  lawyer's review.
- **The worker must run** for invitations, access changes reaching sign-in, plan refreshes and
  the nightly clean-up; publishing a plan does not need it.
- **What the final review left** is under « What remains » above.

## Questions for Mike (we built on the recommended answers)

1. **May pilot teachers use their real students' first names before their principal agrees?**
   We recommend no: invented names or initials, or the sample class, until a principal agrees in
   writing, and we suggest principals keep alerts off. Before real names, have an Ontario privacy
   lawyer spend one or two hours on the pilot terms, a short notice to parents, and our minimum
   retention periods (including the 60-day deletion of substitutes' notes).
2. **Hosting accounts and cost.** Supabase Pro in Canada (about 25 USD a month), an AWS server in
   Montréal (about 24 USD), Amazon's e-mail service in Canada for sign-in codes, backup storage in
   Canada (about 1 USD), a domain, and a free uptime monitor that receives no personal data. We
   recommend yes, under IP Lynx's AWS account, once the name is chosen. Two letters go with it, and
   neither is sent yet: ask Supabase in writing where it keeps its own backups and logs, and ask
   Anthropic for zero data retention (until then, Anthropic keeps what the AI receives for a limited
   time). We prepare both; you send them.
3. **Who administers each pilot board?** If a board asks, you can hold « Administration du
   conseil » for it. You would then see the staff list (names and e-mail addresses), invitations,
   feedback (students' first names are replaced), the AI totals per school, and the board's
   administrative audit entries, including our own access entries; feedback comes to you. We
   recommend that each board also names one of its own staff as administrator, so that someone at
   the board checks our access entries. We also need a privacy contact address (for example
   `confidentialite@iplynx.ca`) and the name of the technical person who gets outage alerts (not
   you).
4. **Retention defaults.** Audit log 2 years; substitute plans 1 year after their date; students'
   first names 1 year after the school year (units and lessons stay; that year's substitute plans
   go with the names); AI usage 2 years; feedback 1 year; backups 30 days. We recommend yes,
   pending the lawyer. Boards can ask for longer through us.
5. **The name.** Still « Lynx École » for now; it is one setting once you choose.
6. **Names the app doesn't know, in AI requests.** Your rule is that nothing personal leaves
   Canada. The app replaces the names it knows (every student and staff member of the teacher's
   schools), but it cannot recognize a name it has never seen, such as a parent's or a brother's
   typed into a text. The teacher sees the exact text before it is sent and is asked to remove such
   a name; every privacy text now says so, and teachers accept the terms with that sentence. We
   recommend keeping it this way. Blocking every capitalized word the app doesn't know would stop
   most ordinary texts (titles, places, characters in a story).

Assumptions that need no answer now (marked **Assumption** in DECISIONS): office staff have no
audit log; contributions are listed without per-teacher counts; invitation messages are sent from
the inviter's own apps; `emailConflict` only says an address exists elsewhere; principals do not
invite; board admins may switch AI on, but not alerts; schools, modules, budgets, retention and
account deletion stay with IP Lynx; the sample class's content and its 60 days; newer terms are
prompted, never blocking; sessions of 7 days and 12 hours idle; breach notice within 24 hours;
backups every 24 hours, a restore within 4 hours; Auth's log kept 90 days; 20 feedback messages a
day; the demo site on a separate server, later.

## What to test with real pilot teachers

`docs/PILOT.md` § 5 has the list: the invitation to the first class, « Bienvenue », setting up a
real class, the sample class, « Commentaires », a principal's dashboard and audit log, Mike as
board admin on his phone, « Nouveautés » and « Confidentialité », and trust after a week.
