# Phase 3: substitute hand-off (« Plan de suppléance »)

Decisions: `DECISIONS.md` D-047 to D-060 (and the Phase 3 amendments to D-012, D-013, D-016,
D-018, D-020, D-029 and D-038). What the AI sees: `docs/ai-data-flow.md`, « Plan de
suppléance ».

## What was built

**For the absent teacher**

- « Je suis absent·e » on Aujourd'hui, and a « Signaler une absence » shortcut on the app icon.
  The form preselects the date (today before dismissal, otherwise the next school day), offers
  morning or afternoon, several days (up to 14), a note and a « Moment de foi » switch, and shows
  what the plan will cover. Two taps from Aujourd'hui. A retried « Envoyer » publishes once; the
  form is kept on the device until it is sent, and a draft restored on a later day keeps the
  date it was for.
- The plan exists as soon as the absence is sent: it is built in the same request from where
  each class left off (next lessons, day by day for several days), the timetable and calendar
  (masses, assemblies, early dismissals, PA days), groups by language level, the class's
  « Fiche de suppléance », contacts, the end of day and a faith moment.
- The absence page: one tab per school day with its release status (« Prêt · publié
  automatiquement le … à 7 h 30 »), « Publier maintenant », « PDF du plan », « Code pour la personne
  suppléante », « Modifier / Je reviens plus tôt », « Mettre à jour le plan » and « Annuler
  l'absence ».
- « Réviser le plan »: every period with its steps; she edits steps, notes, the end-of-day list
  and the faith moment. Edits save themselves and are never lost when the plan is rebuilt.
- Until it goes out, the plan follows her planning: checking off a lesson, changing the
  timetable, the calendar, the class list or the Fiche rebuilds it.
- « Consignes détaillées (IA) » (3b, when the school has AI on): a preview of exactly what would
  be sent, then timed steps with « Dites : » lines, instructions per group and an activity where
  a lesson is thin, under her own edits. « Activités pour les élèves » prints one page per group.
- After the absence: a banner on Aujourd'hui; lessons the substitute marked done count as done
  but wait for her (« Signalée par la suppléance — à confirmer », on Aujourd'hui and in
  Planification); « Suivi de la suppléance » to confirm each lesson (« Confirmer », « Pas
  terminée », « Sautée »). With no report, « Marquer les leçons prévues comme données ».
- Each class has a « Suppléance » tab: the « Fiche de suppléance » (arrival, routines, class
  management, end of day, fallback activities, the colleague next door).

**For the office (secrétariat) and the direction**

- « Suppléances »: today and the next school day (or any date), with each absent teacher's
  classes, rooms, plan status, codes, devices and report status. On a phone the board is also
  linked from Aujourd'hui (a teaching principal) and École.
- « Générer un code »: shown once, large, with the welcome sheet to print and « Texto » and
  « Courriel » links that open the office's own phone or mail app. The app stores no phone
  number and no email address. « Couper » a device, a code, or all access.
- « Voir le plan » and « Imprimer le plan (PDF) » once released. Office never sees « Gestion de
  classe » or alerts; the direction can reveal alerts. Every view and print is logged.
- The direction reads the report (« Voir le suivi », logged); the office sees only its status.
- École: a « Suppléance » card for the direction (access hours, arrival instructions, emergency
  procedures, the half-day split).

**For the substitute (no account)**

- `…/s` or `…/suppleance`, then the code (typed as read over the phone; a texted link fills it
  in, never signs in by itself). A code only works on its day, during the school's access hours;
  typed too early, it says when it opens.
- « Plan de la journée »: « Maintenant » and « Ensuite », the periods with their steps, groups
  with first names, contacts, end of day, and safety or medical alerts only after a tap (logged,
  cleared when the phone is locked or the page is put away, never printed). The screens switch
  to English; the plan stays in the teacher's French. « Télécharger le PDF ».
- « Suivi de la journée »: « Terminé / En partie / Pas fait » per lesson with a note, absent
  students (for information), behaviour and notes for the teacher. It saves itself as she goes;
  « Envoyer le suivi », then « Merci! » and « Terminer ma journée ».

**Behind the scenes**

- Plans are built by the pure builder in `packages/domain/src/sub-plan/` (the web server at
  publish time, the worker when sources change) and stored as three layers (generated,
  teacher's edits, AI).
- The substitute's browser never reaches the API: the web server calls a private database
  schema as a dedicated role (D-049). Codes, devices and addresses are stored only as hashes.
- The worker rebuilds plans (`sub_plan_refresh`) and cleans up every night
  (`sub_access_maintenance`: old codes, sign-in attempts, report notes).
- Migrations `20261001100000` to `20261003100000`; database tests `10` to `14`.

## How to run it

```bash
tools/lite-stack/stack.sh reset   # or: pnpm db:reset (Supabase CLI)
pnpm dev                          # web app
pnpm dev:worker                   # rebuilds plans, runs AI jobs, nightly clean-up
```

`.env.example` has working local values for everything below (copy it to
`apps/web/.env.local`). Demo logins (codes in Mailpit, <http://127.0.0.1:54324>):
`isabelle.tremblay@demo.lynx.test` (3e année teacher), `paul.leblanc@demo.lynx.test` (rotary),
`julie.bergeron@demo.lynx.test` (office), `sophie.lavoie@demo.lynx.test` (principal).

### Settings (web server)

| Variable                  | What it is                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| `SUB_PORTAL_DATABASE_URL` | Direct Postgres connection as `lynx_sub_portal`. Empty: the portal is off. |
| `SUB_CODE_HMAC_KEYS`      | `version:base64(32 bytes)`, at most two (current, previous). Empty: off.   |
| `CLIENT_IP_HEADER`        | Header holding the client address (default `x-forwarded-for`).             |
| `TRUSTED_PROXY_HOPS`      | Number of your proxies that append to that header (default 1; 0 ignores).  |
| `ALERTS_ENCRYPTION_KEYS`  | Also encrypts the report's free text (already required for alerts).        |

Generate a key: `node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"`.
To rotate code keys, add `2:<new>` next to `1:<old>`, restart, and remove `1:` a day later
(codes last one day). Do it outside school hours: per-network throttle counts start again.

### The portal role's password (deployment step)

The migration creates `lynx_sub_portal` without a login. The seed gives it the local-only
password `lynx-sub-portal-local-only`; **never use that anywhere else**. On a real database, as
the database owner:

```sql
alter role lynx_sub_portal with login password '<a long random secret>';
```

Then set `SUB_PORTAL_DATABASE_URL=postgresql://lynx_sub_portal:<secret>@<host>:5432/postgres`
on the web server only. On hosted Supabase, connect through the pooler with the user name
`lynx_sub_portal.<project-ref>`. The role can run the five portal functions and nothing else
(`supabase/tests/00_schema_invariants.test.sql` checks it). Where password logins are refused
for local development, connect as `postgres` with `?options=-c%20role%3Dlynx_sub_portal`.

### Reverse proxy (required in production)

The web server must only be reachable through a reverse proxy that:

- **appends** the client's address to `X-Forwarded-For` (never passes the client's own value on
  as the right-most entry), and set `TRUSTED_PROXY_HOPS` to the number of such proxies in front
  of the app (1 for a single proxy, 2 for a CDN plus a proxy...);
- forwards `Host` and `X-Forwarded-Host` unchanged, so server actions' origin check passes (if
  it cannot, set `experimental.serverActions.allowedOrigins` in `next.config.ts`);
- serves HTTPS (`APP_BASE_URL` starting with `https:` makes the portal's cookies `__Secure-`).

Reached directly, a client can write its own address in the header and drop its device cookie,
so the per-network and per-device delays no longer hold. What still holds: the 50-bit code, and
the cap of 300 failed attempts a minute across everyone (D-051), which also keeps the attempts
table small.

## Demo script (8 minutes)

1. **6 a.m.** As Isabelle on a phone: Aujourd'hui → « Je suis absent·e » → « Envoyer ». The
   absence page shows « Prêt · publié automatiquement le … à 7 h 30 ».
2. « Réviser le plan »: the Français period with the next lesson and its note for the
   substitute, the groups (Samuel, Adam and Aïcha in Débutant), the contacts (M. Gagnon next
   door, 555-0100), the faith moment. Change a step; it saves itself.
3. In another tab, check off that Français lesson in Planification: within seconds the plan
   moves to the following lesson (worker running).
4. **7:30.** As Julie (office): « Suppléances » shows the day. « Générer un code »: the code,
   the welcome sheet, « Texto ». Show « Imprimer le plan (PDF) »: no alerts, no « Gestion de
   classe ».
5. **Substitute**, in a private window: `/s`, type the code in lowercase. « Maintenant »,
   « Élèves » → « Alertes de sécurité ou médicales » (logged), the FR/EN switch (the plan stays
   French). Fill « Suivi de la journée » and send it.
6. As Julie: the board shows « Suivi reçu », and « Couper tout l'accès » ends the substitute's
   access at once.
7. **Next day**, as Isabelle: the banner on Aujourd'hui, « Suivi de la suppléance », confirm
   Français, « Pas terminée » for Math. Planification shows Français done; Math is still next.
8. As Sophie (principal): « Voir le suivi » (read-only, logged).

## Data inventory (for the privacy document)

| Data                                        | Where                                | Who                                | Kept                                                 |
| ------------------------------------------- | ------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| Absence: dates, part of day, note           | `absences`                           | owner, direction, office           | with the teacher's account                           |
| Plan (lessons, steps, first-name groups)    | `sub_plans`, `sub_plan_classes`      | D-056                              | 1 year after the plan date (Assumption; Phase 6 job) |
| Report outcomes, absent-student ids         | `sub_reports.content`                | owner; direction (audited)         | absent list 60 days after confirmation; outcomes 1 y |
| Report free text                            | `sub_reports.notes_ciphertext` (AES) | owner; direction (audited)         | 60 days after confirmation (or after the plan date)  |
| Codes (SHA-256 of an HMAC), issuer and role | `sub_access_codes`                   | issuer's school staff (metadata)   | 30 days after they expire                            |
| Sessions (token hash, device hash)          | `sub_sessions`                       | staff see device numbers and times | with their code                                      |
| Sign-in attempts (device and network hash)  | `sub_code_attempts`                  | nobody through the API             | 1 day                                                |
| Views, prints, reveals, confirmations       | `audit_log` (ids only)               | Phase 6 viewer                     | 2 years                                              |

No substitute's name, phone number or email address is stored. PDFs are never stored.

## Known limits

- **The real Claude API has not been tried** for « Consignes détaillées » (or « Texte
  différencié »); the evaluation (`pnpm ai:eval --feature sub_plan --yes`, about $2) needs a key
  and Mike's go-ahead.
- **A code is a bearer credential.** Whoever holds it sees the day's plan and alerts, the staff
  member who issued it included. Such sessions are visible in the audit (issuer and role on every
  entry); the audit viewer comes in Phase 6.
- **The worker must run** for plans to follow later changes. If it is down, publishing still
  works; the owner sees « Mise à jour du plan… » and can press « Mettre à jour maintenant ».
- **Plans are only as good as the teacher's planning:** thin lessons and missing units give thin
  periods (flagged in the plan). The library (Phase 4) will fill gaps.
- **Back-to-back absences** continue from each other only within a week; a lesson planned on an
  earlier day without a report counts as taught.
- **A draft report confirmed after the day** counts from its last autosave.
- **Office staff cannot enter an absence for a teacher** (Assumption).
- **No hosted deployment yet**: the reverse proxy and the portal role's password are deployment
  steps (above); `DEPLOYMENT.md` comes in Phase 6.

## Questions for Mike (we built on the recommended answers)

1. **Can the secrétariat see and print the plan with students' first names?** Never alerts, never
   « Gestion de classe », every view and print logged. _Built: yes._ Otherwise office staff could
   only release plans and hand out codes.
2. **Should substitutes see safety and medical alerts on their own phone** (hidden until tapped,
   every view logged, cleared when the phone is put away, never printed), or only through the
   principal? _Built: on screen._
3. **Should AI detailed instructions be an optional step the teacher previews, rather than
   automatic at 6 a.m.?** The plan is complete without AI. _Built: optional, with a preview._

Assumptions that need no answer now (in DECISIONS as **Assumption**): absences of at most 14
days; automatic release at 07:30; codes valid 05:00–18:00 on the day; the faith moment on by
default; plans kept 1 year; report notes kept 60 days; « Élèves absents » for information only;
office staff do not enter absences.

## What to test with a real teacher

1. **The 6 a.m. test.** On her own phone, from a locked screen: how long to report an absence
   (target: under 60 s)? Anything confusing when half-asleep?
2. **Plan quality.** Build a plan from her real week. Would a stranger get through the day with
   it? What is missing: routines, where things are, who to call?
3. **Staying current.** Publish for next week, then keep checking off lessons. Does the plan
   follow? Is « Mise à jour du plan… » reassuring or worrying?
4. **« Fiche de suppléance ».** The right fields? Would she keep it up to date? Is the "no medical
   details here" hint clear?
5. **Half days and the calendar.** Is the morning/afternoon split right for her bells? Masses,
   assemblies and early dismissals as she expects?
6. **Groups by level.** Useful to a substitute? Level names acceptable when only adults see them?
7. **Review.** Is editing on a phone realistic, or will she only « Publier maintenant »? Is 7:30
   the right time?
8. **Printing and codes.** Would the office print the plan and the welcome sheet? Is texting the
   code from the office phone fine? Is the PDF readable and complete?
9. **The substitute** (ask a real one): entering the code, finding « Maintenant », finding the
   alerts, filling in the report on a phone during a busy day.
10. **Next-day confirmation.** Fast enough? Does progress land where she expects on Aujourd'hui
    and in Planification?
11. **Language and faith.** Natural Ontario French? The right « Moment de foi » for the grade?
12. **With AI** (if the school has it on): are the « Dites : » steps helpful or too much? Is the
    preview reassuring?
