# Privacy and data protection

This document answers the questions an Ontario school board's privacy officer asks before a pilot
or a contract: what the app collects, where it is stored, who can see it, how long it is kept, and
what happens at the end. It describes release 0.8 (October 2026: Phase 6, « Mon année » and
« Commentaires de bulletin ») of the app called « Lynx École » for now (the name is a placeholder).

It is written in English for privacy and IT staff. The app's own notice, « Confidentialité et
conditions » (`/confidentialite`), says the same in plain French and English for teachers; where
the two differ, tell us and we fix both.

**This is not legal advice.** The pilot terms, this notice and the minimum retention periods have
not yet been reviewed by an Ontario privacy lawyer. That review is planned before real student
data is entered (`docs/PILOT.md`).

**The rule we design to: information that leaves Canada must hold no personal data.** Section 6
lists every place data goes and what it holds. One limit remains, in the text sent to the AI
provider: the app replaces the names it knows (the students and staff of the teacher's schools),
but it cannot recognize a name it does not know, such as a parent's or a sibling's. The teacher
sees the exact text before it is sent and must remove such a name (section 5).

## Contents

1. Quick answers
2. Roles
3. What we never collect
4. Data inventory
5. Data flows
6. Residency and jurisdiction
7. Access controls
8. Security measures
9. Retention schedule
10. Deletion and return
11. Access and correction requests
12. Breach response
13. Children and students
14. The audit log
15. Assurance
16. Contacts and change log

## 1. Quick answers

| Question                                                 | Short answer                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Section |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Where is the data stored?                                | In Canada, by design. Hosted (not live yet): the database and the sign-in service at Supabase in AWS `ca-central-1` (Montréal), and the app's server at AWS in `ca-central-1`; where Supabase keeps its own backups and logs is to be confirmed in writing before go-live. Board-hosted: on the board's own servers.                                                                                                                                                  | 6       |
| What does the app collect about students?                | A first name or nickname, the class, an optional language level, and, only if the principal turns them on, encrypted safety or medical alerts. No last name, Ontario Education Number, birth date, address, photo or e-mail. Students have no accounts. Report card comments a teacher writes stay in her browser; they never reach our servers or the AI.                                                                                                            | 3, 4    |
| Is data sold, used for advertising, or used to train AI? | No, no and no. The AI provider receives the text after the names of the students and staff of the teacher's schools are replaced and the personal details the app detects are refused; another name (a parent's) must be removed by the teacher, who sees the exact text first. It is sent under commercial API terms that do not allow training on it by default.                                                                                                    | 5       |
| Who are the subprocessors?                               | Hosted: Supabase (database, sign-in), Amazon Web Services (server, sign-in e-mails, backup storage), Anthropic (AI: the text a teacher sends, with known names replaced), an uptime monitor (no personal data). Board-hosted: the board's own infrastructure, plus Anthropic only if AI is on.                                                                                                                                                                        | 6       |
| How are we told about a breach?                          | IP Lynx tells the board within 24 hours of confirming it (an Assumption to agree in the contract). The board notifies the Information and Privacy Commissioner and the people affected.                                                                                                                                                                                                                                                                               | 12      |
| What happens at the end of the contract?                 | IP Lynx exports the board's whole audit log for it (CSV) and, if the board wants it, its library; on request IP Lynx prepares an extract of the board's data; then IP Lynx deletes the board within 30 days and confirms in writing. Backups age out within 30 days.                                                                                                                                                                                                  | 10      |
| Can IP Lynx staff see our data?                          | Only named operators, only for support or maintenance, and our rule is to record each access in the board's own audit log first (a rule, not a technical lock: section 7). During the pilot, IP Lynx may also hold the board administrator role, if the board asks (section 2).                                                                                                                                                                                       | 7       |
| Do students use AI?                                      | No. Only teachers, principals and vice-principals, at schools where the principal turned AI on and the board allows it. No AI feature reads a report card comment about a student.                                                                                                                                                                                                                                                                                    | 5, 13   |
| How do people sign in?                                   | With a 6-digit code sent by e-mail; there are no passwords. Sessions end after 7 days, or after 12 hours without activity.                                                                                                                                                                                                                                                                                                                                            | 7       |
| Are there cookies, trackers or analytics?                | Only the cookies the app needs to keep a person signed in, the chosen language and a substitute's or class device's session, plus one preference (the « Moment de foi » choice on the absence form). Unsent drafts stay in the browser until they are sent or the person signs out, and report card comments until sign-out, another account signing in on that browser, or 60 days after the report goes home. No analytics, no advertising, no third-party scripts. | 8       |

## 2. Roles

- **The school board** is the institution under the _Municipal Freedom of Information and
  Protection of Privacy Act_ (MFIPPA). It decides who uses the app, and it controls the personal
  information in it.
- **IP Lynx Inc.** provides the app and, for the hosted install, operates it. It acts on the
  board's instructions and uses the data only to provide the service.
- **Board-hosted installs:** the board's IT runs the app on the board's servers. IP Lynx has no
  access unless the board grants it, and our rule is to record every such access in the board's
  audit log first (`operator.access`, section 14).
- **During the pilot, IP Lynx may hold the board administrator role** (« Administration du
  conseil ») for a pilot board, if the board asks: Mike McLeod, for IP Lynx. It then sees what
  section 7 lists for board admins: the staff list (names, e-mail addresses, roles, access),
  invitations, feedback (students' first names replaced), the AI totals per school and the
  administrative part of the audit log, its own access entries included. We recommend that the
  board also name one of its own staff as an administrator, so that someone at the board reads
  IP Lynx's access entries.

## 3. What we never collect

- About students: no last name, no Ontario Education Number (OEN), no birth date, no address, no
  photo, no student e-mail, no parent contact details, no health card number. A student is a first
  name or nickname in one field (a second student with the same name gets a marker such as
  « Liam 2 »).
- No student accounts. Students never sign in.
- Nothing a student types in class mode. Class devices get numbers (« Appareil 7 ») and fixed team
  names; answers are kept only until the session ends.
- No substitute's name, phone number or e-mail address. A substitute uses a one-day code.
- When a teacher imports a class list, the file is read on her own device: only the chosen
  first-name column is sent. Columns that look sensitive (last name, OEN, birth date, address,
  e-mail, phone, health) are shown as « never sent » and cannot be chosen.
- AI requests refuse e-mails, phone numbers, long identification numbers, postal codes, street
  addresses and a child's birth date: the teacher removes them before anything is sent.
- No analytics, no advertising identifiers, no third-party scripts or fonts in the browser.
- Report card comments (« Bulletins », D-130): composed in the teacher's browser and copied into
  the board's own report card system; never sent to our servers or the AI. Comment banks hold
  phrases with a first-name placeholder (`{prénom}`), no student data.
- Nothing about families: the app sends nothing to families (no e-mail, text message or parent
  account). A teacher copies « Info-parents », the class's weekly message (D-136), herself into
  the board's own channels. No parent contact is stored.

## 4. Data inventory

"Who sees it" uses the roles of section 7. "Kept" is the default; section 9 has the settings a
board can change.

### Staff accounts and sign-in

| Data                                                                                                                                                                                          | Purpose                                       | Who sees it                                                                                                             | Kept                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Profile: name, e-mail, title (Mme, M., Mx), language, access removed or not (`users`)                                                                                                         | Sign-in, display names in plans and the app   | The person; colleagues at the same schools and the board's admins (name, e-mail, title, language and access state only) | Until IP Lynx deletes the account on the board's request                  |
| Roles: teacher, principal, vice-principal, office, board admin, with school (`user_roles`)                                                                                                    | Access control                                | The person; the school's direction; the board's admins                                                                  | With the account                                                          |
| Pilot terms: version and time accepted; checklist hidden or not (`users`)                                                                                                                     | Proof of acceptance; the onboarding checklist | The person only (and IP Lynx)                                                                                           | With the account                                                          |
| Invitations: e-mail, name, title, role, school, status, who invited (`staff_invitations`)                                                                                                     | Creating an account                           | The board's admins                                                                                                      | Pending ones fail after 14 days; processed ones are deleted after 90 days |
| Sign-in service (Supabase Auth): e-mail, account creation and last sign-in times, ban state (`auth.users`, `auth.identities`)                                                                 | Sign-in                                       | Nobody through the app; board admins see only whether a person ever signed in, never when                               | With the account                                                          |
| Sessions: the address and software of the app's server, which makes every call to the sign-in service, never a person's IP address or browser; times (`auth.sessions`, `auth.refresh_tokens`) | Keeping a person signed in                    | Nobody through the app                                                                                                  | Ended after 7 days, or 12 hours without activity; never in our backups    |
| Sign-in service log: e-mail, action, time; no IP address (the app's server makes the calls) (`auth.audit_log_entries`)                                                                        | Investigating sign-in problems                | Nobody through the app                                                                                                  | 90 days; never in our backups                                             |
| Sign-in codes (`auth.one_time_tokens`)                                                                                                                                                        | The 6-digit code                              | Nobody                                                                                                                  | Valid one hour, used once; never in our backups                           |
| Sign-in attempts: keyed hashes of the address and of the network, never in clear (`sign_in_attempts`)                                                                                         | Throttling code guessing (D-121)              | Nobody                                                                                                                  | 2 days                                                                    |

### Classes, students and teaching

| Data                                                                                                                                                                            | Purpose                                                                                | Who sees it                                                                                                        | Kept                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Classes: name, grades, room, teaching team (`classes`, `class_grades`, `class_teachers`)                                                                                        | Planning                                                                               | The class team; the school's direction and office                                                                  | Until the teacher deletes the class                                                                     |
| Students: first name or nickname, default language level (`students`)                                                                                                           | Groups in plans, differentiated texts                                                  | The class team; the school's direction; office staff only in a released substitute plan (audited)                  | One year after the school year ends (then deleted, with their alerts), or when the teacher deletes them |
| Safety or medical alerts, encrypted (`student_alerts`)                                                                                                                          | A substitute's or colleague's safety information                                       | The class team and the school's direction, hidden until tapped; a substitute on screen that day; every read logged | With the student                                                                                        |
| Timetable, units, lessons, progress, notes for substitutes (`timetable_blocks`, `units`, `unit_lessons`, `lesson_progress`, `class_sub_profiles`)                               | The teacher's planning                                                                 | The class team (the direction never sees units, lessons or progress)                                               | Until the teacher deletes the class; kept when the students are purged                                  |
| Planned dates and the attentes a unit aims at (`units`, `unit_expectations`)                                                                                                    | The teacher's year plan (« Mon année », D-123)                                         | The class team (never the direction, office staff or the board)                                                    | With the class; kept when the students are purged                                                       |
| Calendar events: PA days, holidays, masses, outings (`school_calendar_events`)                                                                                                  | « Aujourd'hui » and plans                                                              | Staff of the school or board                                                                                       | Until deleted                                                                                           |
| Family newsletters (« Info-parents »): each week's paragraphs in French and English, who wrote each English paragraph, status, signature, who last edited (`class_newsletters`) | Informing families: the teacher sends it herself, through the board's channels (D-136) | The class team (never the direction, office staff or the board)                                                    | Until deleted; erased with the students' first names (D-138)                                            |
| Report card periods: each school year's evaluation windows, « saisie » and « remise » dates; no personal data (`report_periods`)                                                | Report card dates in the board's calendar and the teachers' year plans (D-124)         | The board's staff; written by its admins                                                                           | Until the school year is deleted                                                                        |
| Sample class (« Classe exemple »): 20 invented first names and sample lessons                                                                                                   | Trying the app without real data                                                       | The teacher who made it                                                                                            | 60 days after creation                                                                                  |

Teachers' units and lessons are free text. A teacher may type a student's name there; that text
stays until the teacher deletes it, also after the students' first names are purged. The notice
shown 60 days before the purge says so.

An « Info-parents » message is free text too, drafted by the app from the class's own planning
and calendar (never an event's notes for staff, an attente, the coverage or anything about a
student) and edited by the teacher. It goes to every family of the class, so it may name a student
for news everyone can read; before it is copied or marked sent the app lists the students it names
and the personal details it holds (nothing is stored about that check). The messages are erased
with the students' first names, and can be deleted at any time.

« Couverture » (D-125) is worked out on each visit from the class's units, lessons and progress;
nothing about it is stored, and only the class team sees it. The long-range plan PDF (« Plan à
long terme », D-127) prints the class's units (titles as typed), their dates and attentes and the
class team's names, and, only if the teacher asks, the year's coverage counts; it reads no student
data and is built when asked, never stored and not sent anywhere: the teacher decides whom to give
it to.

### Substitute hand-off

| Data                                                                                            | Purpose                        | Who sees it                                                                                          | Kept                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Absence: dates, part of day, note (`absences`)                                                  | Covering the teacher's classes | The teacher, the school's direction and office                                                       | One year after its last day, once its plans are gone                |
| Substitute plan: lessons, steps, first-name groups (`sub_plans`, `sub_plan_classes`)            | The day's hand-off             | The teacher; once released, the direction and office (audited) and the substitute that day (audited) | One year after the plan's date                                      |
| Codes: an HMAC hash, issuer and role; sessions and devices (`sub_access_codes`, `sub_sessions`) | One-day access                 | The school's staff see codes and device numbers, never a code itself after it is shown               | 30 days after they expire                                           |
| Code attempts: keyed hashes of device and network, no IP address (`sub_code_attempts`)          | Throttling guessing            | Nobody                                                                                               | 1 day                                                               |
| End-of-day report: lessons done, absent students, notes (notes encrypted) (`sub_reports`)       | Continuity                     | The teacher; the direction (audited); the office sees only that it arrived                           | Notes and absent list 60 days after confirmation; the rest one year |

### Library and AI

| Data                                                                                                          | Purpose                              | Who sees it                                                        | Kept                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Resources: title, content, answer keys, review state, sharing (`library_*`)                                   | Sharing teaching material            | The author; colleagues according to sharing; the board's reviewers | Until the author deletes them; shared ones stay without an author when an account is deleted |
| Comment banks (`library_items`, type `report_comments`): report card phrases with `{prénom}`, no student data | Writing report card comments         | As resources                                                       | As resources: until the author deletes them                                                  |
| Opinions: 1 to 5 stars (`library_item_ratings`)                                                               | Finding good resources               | The rater only; others see an average of at least 5 colleagues     | Until the rater or the resource is deleted                                                   |
| AI requests: the teacher's text, the answer, the exact de-identified text sent (`ai_jobs`)                    | Showing the result and what was sent | The requester only                                                 | 30 days                                                                                      |
| AI usage: date, feature, prompt version, model, tokens, cost, status, no text (`ai_generations`)              | Budgets and billing                  | The author; the direction and board admins see school totals only  | 730 days                                                                                     |
| Request limit log: job, person, time (`ai_request_log`)                                                       | 40 requests an hour per person       | Nobody                                                             | 1 day                                                                                        |
| Bulk generation runs and requests (operator only; the de-identified text sent)                                | The board's starter resources        | IP Lynx; reviewers see runs without inputs                         | 1 year; the text sent 30 days, then only its SHA-256                                         |

`docs/ai-data-flow.md` is the detailed annex: exactly what each AI feature sends.

### On the teacher's device (never sent)

| Data                                                                                                                                                                                                                                                                                                                                                                     | Who sees it          | Kept                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Report card comment drafts (« Bulletins », D-130), in the browser's `localStorage`: per student id (never the name) the level or marks, the chosen bank entries, the wording (neutral, feminine or masculine), the grade in a combined class, « Mes notes » and the comment's text, with the first name replaced by `{prénom}`; the character limit and the copy setting | That browser profile | Until sign-out, « Effacer », another account signing in on that browser, or 60 days after the report's « remise » |

The server gives the composer only what the class team already sees (the students' first names)
and data that is not about a student (the report periods, the subjects, the comment banks and the
attentes taught); the comments never come back to it: no table, no server action, no route
handler, no form and no PDF carries them (a browser test types a marker in every field and finds
it in no request). Known limits: what the browser holds is exposed to what acts on the browser,
such as enhanced spell-check (some browsers send typed text to their maker), writing extensions
and cloud clipboards; « Comment ça marche » on the page says so, and boards can manage those
settings on their devices. On a computer nobody signs out of, the comments stay until another
account signs in or they expire, in template form (no first names).

### Class mode

| Data                                                                                        | Who sees it                              | Kept                                                   |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Session: class, resource, questions without answers, join code (`class_sessions`)           | The class team (teacher role)            | Questions emptied at the end; closed sessions 30 days  |
| Devices: number, team, hashes of the device token and cookie (`session_participants`)       | Nobody through the API                   | Until the session ends (at most 2 hours and 5 minutes) |
| Answers: chosen options, score; a short answer's text is never stored (`session_responses`) | Nobody through the API                   | Until the session ends                                 |
| Kept class results: counts per question and team scores, no device and no name              | The class team, if the teacher kept them | 365 days, or until « Supprimer »                       |
| The class link, in plain text so the teacher can show it again (`class_mode_links`)         | The class team                           | Until replaced, or the class is deleted                |
| Join failures: keyed hashes of device and network (`class_join_failures`)                   | Nobody                                   | 1 day                                                  |

### Pilot and operations

| Data                                                                                                                                                           | Who sees it                                                                                                                                  | Kept                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Feedback: kind, message (up to 2,000 characters), page template, error reference, release, device class, language (`feedback`)                                 | The board's admins (IP Lynx too, when it holds that role during the pilot); the sender's name and e-mail only if they agreed to be contacted | 365 days                                |
| Audit log: who did what to which record, ids and short codes only (`audit_log`)                                                                                | Section 14                                                                                                                                   | 730 days                                |
| Event outbox: event type and ids, never names (`event_outbox`)                                                                                                 | Nobody                                                                                                                                       | 90 days after it is handled             |
| Heartbeats: last run of the worker, the backup and the clean-up, with counts (`system_heartbeats`)                                                             | Board admins see « normal » or « à vérifier » and times only                                                                                 | One row per service, replaced each time |
| Server logs: the app's own are scrubbed JSON lines; board-hosted, the sign-in service and the database add warnings and errors in their own format (section 8) | IP Lynx (or the board's IT, board-hosted)                                                                                                    | 14 days                                 |
| Proxy access logs: time, page address without codes, tokens or search words, status, masked IP address                                                         | IP Lynx (or the board's IT)                                                                                                                  | 14 days                                 |
| Backups: the database's data, encrypted (section 8)                                                                                                            | Nobody without the private key, kept offline                                                                                                 | 30 days                                 |

Before feedback is stored, the server replaces the first names of the students of the sender's
schools with « [élève] » (« [student] » in English), and other personal details must be removed
before sending. A name the app does not know (a parent's, a sibling's) cannot be recognized.

## 5. Data flows

```
 Staff browser ──HTTPS──▶ Caddy (proxy) ──▶ web server ──HTTPS──▶ Supabase API and Auth
                          └──── the app's server, in Canada ────┘   └─ database, in Canada ─┘
                                                │
                                              worker ──▶ database (Canada)
                                                │
                                                └──HTTPS──▶ Anthropic API (US): the text sent, known names
                                                            replaced, only when a teacher asks for AI help

 Supabase Auth ──▶ e-mail service (Amazon SES ca-central-1, or the board's relay) ──▶ the person's mailbox
                   the 6-digit sign-in code

 Board admin's own e-mail or texting app ──▶ the invited person: the sign-in address and their e-mail
 Office's own e-mail or texting app ──▶ the substitute: a one-day code (in the link's fragment)

 Substitute's phone ──HTTPS──▶ Caddy ──▶ web server (a dedicated database role, the day's plan only)
 Class devices (tablets) ──HTTPS──▶ Caddy ──▶ web server (a second dedicated role, no table access)

 backup job (on the server) ──▶ encrypted file ──▶ Amazon S3 ca-central-1 (or the board's S3-compatible storage)
 worker and backup ──▶ uptime monitor: a ping to a URL, no data
 uptime monitor ──▶ /api/health/ready: answers « ok » or « unavailable », nothing else
```

- **The browser never calls Supabase or any other service directly.** Every page and request goes
  to the app's own server (Content Security Policy `connect-src 'self'`).
- **No invitation e-mail leaves our servers.** The board admin's page prepares the message and the
  admin sends it from their own e-mail or texting app. Our only outgoing e-mail is the sign-in code.
- **AI:** the worker replaces the names of the people the app knows (every student and staff
  member of the teacher's schools, and the staff of their boards) with a marker (« Élève A »,
  « Adulte B »), refuses the personal details it detects (e-mail addresses, phone numbers,
  identification numbers, postal codes, street addresses, a child's birth date), checks the exact
  outbound text once more, and sends no user, school or board identifier. Names are put back only
  on our server. **A name the app does not know** (a parent's, a sibling's, a student of another
  school) is not recognized: the teacher sees the exact text before sending, and the preview asks
  her to remove any such name. `docs/ai-data-flow.md` has the details.
- **AI, report card comment banks (« Créer une banque avec l'IA », D-132):** the request carries
  curriculum labels and the teacher's note only: the grade, the subject, the report, the chosen
  attentes and the length of the entries, built by the database from ids, and the note
  (« Précisions »), de-identified like any other. No student, class, school or identifier, and no
  report card comment, is part of it; the bank comes back with the placeholder `{prénom}`.

## 6. Residency and jurisdiction

**Hosted by IP Lynx** (no hosted install is live yet; this is the design `DEPLOYMENT.md` sets up):

| Component                                                       | Location                                               | Personal data                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase: database, sign-in service                             | AWS `ca-central-1` (Montréal)                          | Yes                                                                                                                                                                                                                                                                                                                                             |
| Supabase's daily backups                                        | **To confirm in writing with Supabase before go-live** | Yes                                                                                                                                                                                                                                                                                                                                             |
| Supabase platform logs (API gateway, database, sign-in service) | **To confirm in writing with Supabase before go-live** | May include e-mail addresses in sign-in logs and error text; no personal value is ever put in an API address                                                                                                                                                                                                                                    |
| The app's server: proxy, web server, worker                     | AWS Lightsail `ca-central-1`                           | Yes, while processing; logs kept 14 days on the server                                                                                                                                                                                                                                                                                          |
| Sign-in e-mails                                                 | Amazon SES `ca-central-1`                              | Staff e-mail addresses and the code                                                                                                                                                                                                                                                                                                             |
| Our backup copies                                               | Amazon S3 `ca-central-1`, encrypted before upload      | Yes, encrypted                                                                                                                                                                                                                                                                                                                                  |
| Anthropic API                                                   | United States                                          | The text a teacher sends: names the app knows replaced and the details it detects refused; a name it does not know is removed by the teacher at the preview. Zero data retention: to be requested before real data (not sent yet); until it is in place, Anthropic keeps API inputs and outputs for a limited period under its commercial terms |
| Uptime and heartbeat monitor                                    | Outside Canada possibly                                | None: URLs and pings only                                                                                                                                                                                                                                                                                                                       |
| GitHub (source code)                                            | United States                                          | None: code only                                                                                                                                                                                                                                                                                                                                 |
| Let's Encrypt (TLS certificates)                                | United States                                          | None: the app's domain name only                                                                                                                                                                                                                                                                                                                |

**Board-hosted:** everything above runs on the board's servers, with the board's mail relay and
storage. Only the Anthropic API (if AI is on), Let's Encrypt (unless the board uses its own
certificates) and an uptime monitor (if the board uses one; it receives no data) are reached
outside the board.

**Things to know:**

- Supabase, Amazon and Anthropic are US companies. US law (the CLOUD Act) can require a US company
  to produce data it controls, even when that data is stored in Canada. Storing in Canada and
  sending only text with known names replaced abroad limits what such a request could reach.
- Supabase staff can access a project for support under Supabase's terms. Our requests to Supabase
  are encrypted (TLS); where that TLS connection is terminated for `*.supabase.co` addresses is
  among the questions we put to Supabase in writing before go-live.
- No hosted install is live yet. Before real data is entered, IP Lynx needs Supabase's written
  answer on where platform logs and backups are kept and where TLS terminates, and Anthropic's
  decision on zero data retention. Neither request has been sent yet (`docs/PILOT.md` § 1).

## 7. Access controls

**Roles.** Each person sees only what their role allows. Row level security on every table enforces
this in the database, and about 1,700 automated database tests check it.

| Role                      | Sees                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Teacher                   | Their classes: students, alerts (hidden until tapped, each read logged), timetable, planning, progress. Their own absences and plans. The library by sharing. Their own AI usage.                                                                                                                                                                                        |
| Principal, vice-principal | Their school's classes, rosters and schedules, and alerts (read-only, logged); released substitute plans and reports (logged); « Tableau de bord de la direction »; the school's audit log. **Never** a teacher's units, lessons or progress.                                                                                                                            |
| Office staff              | Their school's classes and schedules, no rosters; released substitute plans with first names (logged, without « Gestion de classe »); codes. No alerts, no audit log.                                                                                                                                                                                                    |
| Board admin               | The board's schools and settings, staff list (name, e-mail, roles, access state, whether they ever signed in), invitations, school years, reviewers, AI totals per school, feedback, and the administrative part of the audit log. No student data. During the pilot, IP Lynx may hold this role (section 2).                                                            |
| Substitute (no account)   | With a one-day code: that day's released plan for the classes covered, alerts on screen when tapped (each reveal logged), the end-of-day report.                                                                                                                                                                                                                         |
| Students (no account)     | On a class device during a quiz: the questions, never the answers or anyone's name.                                                                                                                                                                                                                                                                                      |
| IP Lynx operator          | Hosted: the service key and the database password (on the server and in the operator's password manager), the admin command line, `psql` as the database owner, and Supabase's dashboard, whose table and SQL editors read every row (our rule: named operators only, with two-factor sign-in). No operator screen in the app. Board-hosted: only what the board grants. |

**Sign-in.** A 6-digit code sent by e-mail, valid one hour; no passwords. Accounts exist only by
invitation (self sign-up is off). A session ends after 7 days, or after 12 hours without activity,
which suits shared classroom computers. Removing a person's access (« Retirer l'accès ») takes
effect at their next request and bans their sign-in.

**Substitutes.** A code is about 50 bits of randomness, stored only as a keyed hash, valid for its
day, revocable at once by the office, and throttled per device and network. Whoever holds a code
sees the day's plan: every view, print and alert reveal is logged with the code's issuer, and the
audit log flags codes the office issued (section 14).

**Class devices.** They reach the database through a dedicated role that runs five functions and
reads no table. Answer keys never reach a device.

**IP Lynx's access.** Named operators only. The service key is held on the server (the worker and
the admin command line) and in the operator's password manager; it never reaches the web server
or the app's pages. Hosted, Supabase's dashboard also shows it, and every row, in a browser:
opening a board's data there counts as access. Before any access to production data for support,
an incident, a restore or an upgrade, the operator records it
(`pnpm admin log-operator-access --board … --reason …`); the board's admins see each entry in
their audit log. Changes the operator makes to a board's settings, modules, AI budgets or
retention, and to a person's access, are logged for the board the same way. This recording is an operating rule that `DEPLOYMENT.md` makes
mandatory; the database cannot force someone who holds the service key to record their access
first.

## 8. Security measures

- **In transit:** HTTPS only (TLS 1.2 or 1.3), HSTS for one year. Hosted, the app's server talks
  to Supabase's API and database over TLS, verifying Supabase's certificates. Board-hosted, the
  database and the sign-in service sit on the server's internal network and are not reachable from
  outside.
- **At rest:** the hosted database is encrypted on disk by Supabase. Safety and medical alerts and
  substitutes' report notes are also encrypted by the app (AES-256-GCM, each tied to its student or
  report) with keys only the web server holds, so a database copy alone cannot read them. Backups
  are encrypted with `age` before they leave the server; the private key is kept offline by the
  operator (and, board-hosted, in the board's vault), never on the server. Each backup is also
  signed (HMAC-SHA256 with a key generated per install); the restore refuses an unsigned or
  altered file, and a dump holding anything but data, before loading anything. Once a month a
  backup is restored to test it (board-hosted, into a throw-away install on the operator's
  encrypted workstation; hosted, into a staging Supabase project in Canada); the access is
  recorded for each board and the copy is destroyed afterwards.
- **Keys:** generated per install (`generate-secrets.mjs`, file mode 0600), never in the code, the
  images or the backups. Board-hosted, the database's statement logging is off, so its first start
  no longer writes the administrator's password to the journal (checked in CI). Alert keys and
  code keys rotate with a version number (`DEPLOYMENT.md`).
- **Browser:** a Content Security Policy allows only the app's own scripts, styles, fonts and
  connections, and forbids framing. No third-party scripts, fonts, trackers or analytics.
  `X-Robots-Tag: noindex, nofollow` on every page.
- **Logs:** the app's own logs (web server and worker) are JSON lines in which every text is
  scrubbed: e-mail addresses, phone numbers, postal codes, long numbers (OEN, health cards),
  tokens, keys, quoted values and the values the database echoes back in its errors are removed.
  An error is reduced to its name, code, reference and scrubbed message, never its other fields.
  Browsers report errors as a name, a reference, the page template and a hash of the message. A
  first name in free text cannot be recognized automatically, which is why logs never record what
  people typed. Board-hosted, the sign-in service and the database also write to the server's
  journal, in their own format and **not scrubbed**: the sign-in service only its warnings and
  errors, the database no statements and its errors without their detail. CI checks that after a
  test install has run, the journal holds no e-mail address and no password. Even so, an error
  can quote a value it refused, and a mail relay's refusal can name the address it refused. The
  admin command line's replies, which name the people a command acted on, are shown to the
  operator and never kept. Logs stay on the server for 14 days, readable only by its
  administrators. Hosted, Supabase keeps its own logs of the database, the API gateway and the
  sign-in service, which may hold e-mail addresses (section 6). No third-party error service.
- **Proxy logs:** client IP addresses are masked (/24 for IPv4, /64 for IPv6); cookies,
  authorization headers, sign-in tokens, substitute codes, search words and the previous page's
  address are removed.
- **No personal values in addresses:** the app never puts an e-mail address or a name in an API
  address (lookups go in the request body), because gateway logs record addresses; an automated
  code check enforces it. Substitute codes and class links travel after `#`, which browsers never
  send to a server.
- **Least privilege:** every new table starts closed; signed-in users get explicit grants, often
  per column; database functions that can act for others check the caller; operator functions run
  only with the service key. Each service in Docker Compose receives only its own settings.
- **Updates:** dependency versions are pinned (lockfile, images pinned by digest), so the images'
  security updates arrive only with a release: IP Lynx updates the pinned versions, and the
  operator installs the release (`DEPLOYMENT.md` § 7). Rebuilding without a release changes
  nothing. Hosted, the server's own system updates itself (unattended upgrades). Every change runs
  the full automated test suite in CI (section 15).

## 9. Retention schedule

Deletions run every night (the worker's clean-up). Settings marked "per board" can be changed by
IP Lynx at the board's request, within the bounds shown. **The minimums are under legal review:**
MFIPPA Regulation 823 may require keeping personal information for a year after its last use,
which is why no per-board setting of personal data goes below 365 days (kept class results hold
counts only, and may be kept less).

| Data                                                                                                                  | Kept by default                                        | Per board (bounds) |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------ |
| Audit log                                                                                                             | 730 days                                               | 365 to 3,650 days  |
| Substitute plans, with their codes, sessions and structured report                                                    | 365 days after the plan's date                         | 365 to 1,095 days  |
| Absences with no plan left                                                                                            | 365 days after their last day                          | as above           |
| Report notes and absent-student list                                                                                  | 60 days after the teacher confirms (or after the date) | no                 |
| Substitute codes and sessions                                                                                         | 30 days after they expire                              | no                 |
| Code attempts, class join failures                                                                                    | 1 day                                                  | no                 |
| Students' first names, levels, alerts and the class's « Info-parents » messages (the class's teaching material stays) | 365 days after the school year ends                    | 365 to 1,095 days  |
| Sample classes                                                                                                        | 60 days after creation                                 | no                 |
| Report card comment drafts (device only, never on our servers)                                                        | sign-out, or 60 days after the remise                  | no                 |
| AI requests (text, answer, text sent)                                                                                 | 30 days                                                | no                 |
| AI usage ledger                                                                                                       | 730 days                                               | 365 to 3,650 days  |
| Feedback                                                                                                              | 365 days                                               | 365 to 1,095 days  |
| Invitations                                                                                                           | pending: 14 days; processed: 90 days                   | no                 |
| Event outbox                                                                                                          | 90 days after handling                                 | no                 |
| Sign-in service log (e-mails, actions)                                                                                | 90 days                                                | no                 |
| Class mode answers and devices                                                                                        | until the session ends (at most 2 h 5 min)             | no                 |
| Kept class results (counts only)                                                                                      | 365 days                                               | 1 to 3,650 days    |
| Bulk generation runs; the text they sent                                                                              | 1 year; the text 30 days                               | no                 |
| Server and proxy logs                                                                                                 | 14 days                                                | no                 |
| Our backups                                                                                                           | 30 days                                                | no                 |
| Supabase's own daily backups (hosted)                                                                                 | 7 days                                                 | no                 |
| Accounts, classes, planning, library resources                                                                        | until deleted (section 10)                             | no                 |

- The class purge removes the students' first names and levels, their alerts, the substitute plans
  of the class's own school year that covered the class, its class mode link and its « Info-parents »
  messages (D-138); none can be added afterwards. It keeps the
  teacher's units, lessons, timetable, progress and « Fiche de suppléance », and the kept class
  results (counts only, with their own retention). Teachers see a notice 60 days before; if a
  school year's dates or the setting change so that the date has already passed, the purge waits
  until the notice has shown for 60 days.
- Deleted data remains in backups until those backups expire (at most 30 days).
- On hosted Supabase the clean-up may not be allowed to delete the sign-in service's own log. The
  job then reports it, and that log follows Supabase's own retention; we will confirm it with
  Supabase.
- Deactivated accounts are not deleted automatically: IP Lynx deletes them on the board's request.

## 10. Deletion and return

**Teachers delete** a class (with its students, alerts, plans and teaching material, at once), a
student, their sample class, and their own library resources.

**The board asks IP Lynx to delete** an account (after removing the person's access in « Conseil »):
`pnpm admin delete-user` deletes their classes where they were the only homeroom teacher, their
substitute plans, private resources, feedback, invitations (which hold their address and name)
and profile, then their sign-in account. Shared and
approved resources stay, without an author.

**At the end of a contract:**

1. IP Lynx exports the board's whole audit log (`pnpm admin export-audit`): every entry, of every
   audience and date, as one CSV file with the names of the people who acted, and gives it to the
   board (its privacy office: the file includes the entries the app shows to nobody, such as
   teachers' AI requests). The export is itself in the board's log. A board admin's « Journal
   d'audit » download is not enough: it holds the administrative entries only, a year at a time,
   and each principal's holds only the school's. IP Lynx deletes its copy once the board has the
   file.
2. The board can also take its library (a content pack, prepared by IP Lynx with
   `pnpm admin export-pack`).
3. On request, IP Lynx prepares an extract of the board's data (manual during the pilot).
4. IP Lynx runs `pnpm admin delete-board` within 30 days. It refuses unless the whole audit log
   was exported in the 7 days before. It deletes the board's schools, classes, students, plans,
   resources, audit log, and the accounts of people who worked only for that board; the few
   entries written after the export (the operator's access record, for example) are not in the
   file, and the command says how many. IP Lynx confirms the deletion in writing.
5. Backups that still hold the board's data expire within 30 days.

## 11. Access and correction requests

The board handles requests under MFIPPA. A person can correct their own name and title in
« Profil »; teachers correct their students' first names. IP Lynx provides the records the board
needs to answer a request (manual during the pilot: an extract prepared on request). A per-student
export is not built: by design the app holds little about a student (a first name, a level, the
class, alerts).

## 12. Breach response

1. **Detect:** monitoring of the service, scrubbed logs, the audit log, and reports from users.
2. **Notify the board** within 24 hours of confirming a breach that affects its data (an
   **Assumption** to agree in the contract), with what is known and what is being done.
3. **Contain:** remove access, rotate keys (sign-in, alert, code, database), restore from backup if
   needed. IP Lynx records its access in the board's audit log (`operator.access`, reason
   `incident`) and lists each step in the written report. A new alert key protects new alerts only:
   there is no re-encryption yet, so alerts already stored stay readable with a leaked key in a
   leaked copy of the database.
4. **The board notifies** the Information and Privacy Commissioner of Ontario and the people
   affected, as MFIPPA requires; IP Lynx provides the facts.
5. **Report:** a written post-incident report with the cause and the changes made.

## 13. Children and students

- Students have no accounts and never sign in.
- Students never use AI. AI features are for teachers, principals and vice-principals only.
- No AI feature reads a comment about a student: report card comments are composed in the
  teacher's browser and never leave it (D-130, D-133).
- In class mode, students join a quiz on class devices with a number; nothing they type is stored,
  and their answers are deleted when the session ends.
- A teacher may keep class results: counts per question and team scores, with no device and no
  name, for a year.
- During the pilot, the terms ask teachers to use invented first names or initials, or the sample
  class, until their principal agrees in writing. We recommend that principals keep alerts off
  (their switch in « École »); nothing locks them off.

## 14. The audit log

**What is logged.** Every read and change of an alert; every view, print and alert reveal of a
substitute plan, with the code's issuer and role; codes issued and revoked; reports; absences;
class team changes and class deletions; roles granted and revoked; access removed and restored;
invitations; AI and alert switches; library approvals and reviewers; the operator's access and
settings changes; retention runs (counts); exports of the log itself. An entry holds who, when,
what, and ids and short codes. **Never** a student's name, an alert's text, a note or a title: a
database check refuses the usual free-text fields (names, notes, titles, messages) and long
strings in new entries. A deleted class's entry keeps the class's name as the teacher typed it.

**Who reads it.** Nobody reads the table directly. One database function serves it, and each kind
of entry has an audience:

| Audience                                      | Reads                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The school's principal and VPs                | Alerts, absences, substitute plans, codes, sessions and reports, class team changes, class deletions and purges     |
| The school's direction and the board's admins | Roles, access, invitations, the AI and alert switches, exports of the log                                           |
| The board's admins only                       | Library approvals and reviewers, content packs and bulk runs, IP Lynx's access and settings changes, retention runs |
| Nobody through the app (IP Lynx only)         | A teacher's private professional activity: drafting and sharing steps, AI requests, class mode, terms acceptance    |

So a board admin never sees sick days, substitute activity or alert reads. Labels follow the same
rules: a student appears only as their class (« Élève · 3e année »). A substitute's entry whose
code the office issued carries the flag « Code émis par le secrétariat ». Each reader can export
what they read as CSV (at most 10,000 entries and a year per file); each export is itself logged.
At the end of a contract IP Lynx exports the whole log for the board (section 10). Entries are
kept 730 days.

## 15. Assurance

- **Automated tests**, run on every change in CI (GitHub Actions) and on a fresh database: 1,302
  unit tests, 1,715 database tests (row level security, audit, retention, access), 93 integration
  tests, and 130 browser tests on desktop, phone and tablet, with automated accessibility checks
  (axe, WCAG 2 A and AA) on the main pages. CI also restores a backup into an empty database and
  checks it, and starts the board-hosted install from the Docker images, then checks that its
  journal holds no e-mail address and no password.
- **Subprocessors:** Supabase and AWS publish their security certifications (Supabase: SOC 2 Type 2;
  AWS: SOC 1, 2 and 3, ISO 27001 and others). Boards can request the reports from them.
- **Not done yet:** an independent penetration test (recommended before paid boards), a formal
  accessibility audit (the target is WCAG 2.0 AA under AODA), and the lawyer's review of the terms.

## 16. Contacts and change log

- **Privacy questions:** the address shown on the app's « Confidentialité » page
  (`PRIVACY_CONTACT_EMAIL`), or the board's own privacy office.
- **Support:** the address shown in the app (`SUPPORT_EMAIL`).
- **Decisions behind this document:** `DECISIONS.md` (D-012 to D-019, D-037 to D-046, D-049 to
  D-059, D-065, D-083 to D-093, D-102 to D-138, D-140).

| Date       | Release | Change                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | 0.6     | First version, written for the pilot. Pending a privacy lawyer's review.                                                                                                                                                                                                                                                                                                                              |
| 2026-10-02 | 0.6     | After the final review: the AI limit (names the app does not know), what the sign-in service and the database write to the journal, the hosting facts still to confirm, IP Lynx as a pilot board's administrator, the full audit export before a board is deleted, the monthly restore test. The in-app notice changed with it (terms version `2026-10-pilote-2`).                                    |
| 2026-10-02 | 0.7     | « Mon année »: a unit's planned dates and the attentes it aims at (the class team's, kept with the class), and the board's report card periods (no personal data). No new personal data and no AI, so the pilot terms are unchanged.                                                                                                                                                                  |
| 2026-10-02 | 0.7     | « Couverture » (worked out on each visit; nothing stored) and the long-range plan PDF (no student data; built when asked, never stored, the teacher's to give). No new personal data, so the pilot terms are unchanged.                                                                                                                                                                               |
| 2026-10-03 | 0.8     | « Commentaires de bulletin »: comment banks in the library (phrases with `{prénom}`, no student data), « Créer une banque avec l'IA » (curriculum labels and the teacher's note only), and « Bulletins », which composes report card comments in the teacher's browser only (sections 1, 3, 4, 5, 9, 13). The notice, the terms and « Bienvenue » changed with it (terms version `2026-10-pilote-3`). |
