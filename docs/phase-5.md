# Phase 5: library growth and class mode (« Mode classe »)

Decisions: `DECISIONS.md` D-082 to D-101 (and the Phase 5 amendments to D-012, D-013, D-018,
D-037, D-041, D-063, D-065, D-079 and D-081). What the AI sees in bulk generation:
`docs/ai-data-flow.md`, « Génération en lot ». Moving resources between installs:
`docs/content-packs.md` (written for a board's IT).

## What was built

**For teachers, in class** (and the direction when they teach the class)

- **« Présenter à la classe »** on a resource's page (`/projector/items/<id>`): a full-screen
  projector player with no app navigation. A quiz, exit ticket or game shows one question per
  slide, with each choice's letter, shape and colour, and « Afficher la réponse » fetches only that
  question's answer and explanation. A brain break or an experiment shows one step per slide in
  56 px type; an experiment opens on « Sécurité », made only of the reminders written for students
  (never the teacher's safety notes, which can mention a child's allergy). Any other projectable
  resource (a morning prayer, a song, a riddle) shows its student document in large type, one
  section per slide. ← and → move, the slide is in the address (a refresh keeps the place), a
  visual timer (30 s, 1 min, 2 min, no sound) and « Plein écran ». Nothing is written to the
  database, and no level name is ever projected.
- **« Lancer un quiz sur les appareils »** on a quiz (or a game with questions): the class, the
  version (base by default, the others under « Autre version »), « En équipes » (2 to 6 teams) or
  « Chacun pour soi », a timer (none by default), « Montrer la bonne réponse après chaque
  question » (on by default) and, under « Options », « Les élèves choisissent leur équipe » and
  « Noter les réponses courtes (orthographe exacte) ». Before it starts, the device-visible text is
  checked for the class's first names (« Lancer quand même »).
- **The projector** (`/projector/sessions/<id>`): « Rejoignez la partie » with the address, the
  6-character code in 120 px type (« K7M 4R9 ») and the class link's QR code, and one tile per
  team (« Les Huards · 5 appareils »); « Commencer » (it also closes joining), « Fermer / Rouvrir
  les inscriptions » (joining closes by itself after 20 minutes); each question with « 18 réponses
  sur 27 » and the countdown; « Afficher la réponse » with the class's answers as bars and numbers,
  and, when answers are shown, « Bonne réponse », how many found it and the explanation;
  « Classement des équipes » (class figures only in « Chacun pour soi »); « Terminer la séance »
  (« Garder les résultats de la classe (sans noms) », off by default). « Appareils » lists the
  devices by number, with « Changer d'équipe » and « Retirer ». It fits 1920 × 1080, 1366 × 768,
  1280 × 720/800 and 4:3 projectors (six teams on the lobby; a long question scrolls, and the
  reveal brings the right answer into view).
- **The class tab « Mode classe »** (`/classes/<id>/class-mode`): « Séance en cours » (possibly a
  colleague's) with « Reprendre la projection » and « Terminer la séance » (so a forgotten session
  can be ended from a phone), « Lien de la classe » (the link, its QR code, « Copier le lien »,
  « Remplacer le lien ») and « Résultats gardés » (per question: % correct, the choice bars, team
  scores; « Supprimer »; kept a year).

**For students, on class tablets or Chromebooks** (`/jouer`, no account, in French whatever the
device's language; Anglais content in English)

- A device that opened the class link once and bookmarked it joins by itself when the teacher
  opens a lobby (« En attente de la partie… »); any other device types the code (spaces, hyphens
  and lower case accepted).
- « Tu es l'appareil 7 », « Ton équipe : Les Castors » (or six big team buttons when students
  choose). Every question kind: multiple choice (A–D buttons with colour **and** shape), « Vrai /
  Faux », matching (one native list per item), ordering (« Monter / Descendre ») and short answer
  (no autocomplete, autocorrect or spell check). « Réponse envoyée! », then, when the teacher
  shows answers, « Bonne réponse! +100 points » or « Pas cette fois. » (never the right answer),
  the ranking, and « La partie est terminée. Merci! ». 64 px targets, 22 px text and more, no
  sound, reduced motion respected.

**For teachers, in the library**

- **« Adapter cette ressource »**: a private copy that opens in the editor, credited « Adaptée de
  « … » » (the author and school, « Conseil scolaire », or the pack), with a sharing cap (an
  adaptation of a resource shared with one school stays within that school). Approved resources
  stay read-only: to change one, even her own, a teacher adapts it. A licence can forbid it.
- **« Votre avis »**: 1 to 5 stars on board-approved resources she did not write, anonymous,
  « Retirer mon avis ». Cards and the page show « ★ 4,5 sur 5 (7 avis) » from 5 of her
  colleagues' opinions (never her own; an opinion counts once it is a day old), and « Utilisée
  dans 12 unités ».
- **« Couverture du curriculum »** (`/library/coverage`, from the hub and « Parcourir le
  curriculum »): per grade and subject, each attente with the board's approved resources (badges
  « Aucune ressource approuvée », « 1 ressource approuvée », « À vérifier »), filters and a
  threshold, « Comment on compte », « Vue d'ensemble » (« 14 sur 22 »), and « Créer une
  ressource » / « Créer avec l'IA pour cette attente ».

**For the board's content reviewers**

- « Brouillons du conseil » in « Approbation des ressources »: the AI drafts of each bulk run
  under its summary line (« Lot du 3 novembre : 42 créées · 3 titres semblables · 2 échecs · 6,84
  $ US sur 25 $ US »), flags « Titre semblable à une ressource existante » and « Prénom d'élève
  possible », and « Autres brouillons du conseil » (pack imports that are not ready). On a draft:
  « Approuver pour le conseil » (reviewed, proposed and approved in one step; faith content goes
  to its faith review first) or « Supprimer le brouillon ».
- Pack imports wait in « À approuver » with the badge « Ensemble : … » and, in « Détails »,
  « Éditeur déclaré : IP Lynx · importé le … · empreinte 3fa4c1d2e9b0 ».
- Coverage shows them « en révision » too.

**For the operator (IP Lynx, or a board's IT on a board-hosted install)**: the admin CLI only.

- `pnpm admin coverage` (the same numbers as the page; `--csv`).
- Bulk generation: `bulk-plan`, `bulk-start`, `bulk-status`, `bulk-cancel`, `bulk-report`.
- Content packs: `export-pack`, `import-pack` (a dry run by default), `list-packs`, and `pnpm
library:pack` (the demo folder as a pack).

**Hardening (the review of the Phase 5 build, 14 findings, all fixed with tests;
`20261101090500_phase5_review_fixes.sql`, pgTAP 26):**

- **Answer keys:** the option ids sent to devices could give away ordering and matching answers
  (the editor numbers items in the answer's order); each session now names options by their place
  on screen only, and writes its key with those ids. With answers hidden, the projector no longer
  shows « 3 bonnes réponses sur 4 » beside the per-choice counts (which named the right choice).
- **Projector on real classroom screens:** the right choice's text no longer shrinks to a column a
  letter wide at 1366 × 768; the lobby fits six teams on 1024 × 768 to 1920 × 1080; the reveal
  scrolls to the right answer, and the screen's scrolling region is reachable by keyboard; the
  answer count is in projector type beside « Question 3 sur 10 »; the presenter's slide keeps
  clear of its countdown; device texts are 22 px or more; content keeps its language in
  accessible names, explanations, hints and kept results; « 1 connecté sur 3 » agrees in number.
- **Opinions:** changing one's own stars could reveal colleagues' exact stars; what a person sees
  now leaves her own out and counts an opinion once it is a day old.
- **Board content:** deleting a board resource is audited (`library_item.deleted`, including
  whether it was ever approved), and a resource a pack created and a reviewer deleted is never
  brought back by a later version (`skipped_deleted_locally`).

## How to run it

```bash
tools/lite-stack/stack.sh reset   # or: pnpm db:reset (Supabase CLI)
pnpm dev                          # web app (and the device pages under /jouer)
pnpm dev:worker                   # class-mode clean-up, bulk runs, nightly library clean-up
```

Demo logins (codes in Mailpit, <http://127.0.0.1:54324>): `isabelle.tremblay@demo.lynx.test`
(3e année, whose class has a kept result and a class link), `marc.gagnon@demo.lynx.test` (5e
année), `nathalie.roy@demo.lynx.test` (content and faith reviewer), `sophie.lavoie@demo.lynx.test`
(principal). The demo quiz « Quiz : les nombres jusqu'à 1 000 » plays on devices.

### Settings

| Variable                                 | Where         | What it is                                                                                                                 |
| ---------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CLASS_PORTAL_DATABASE_URL`              | web           | Direct Postgres connection as `lynx_class_portal` (a pool of 5, 3 s statement timeout). Empty: quizzes on devices are off. |
| `CLASS_PORTAL_HMAC_KEY`                  | web           | base64 of 32 random bytes: the key of the devices' throttle HMACs. Empty: quizzes on devices are off.                      |
| `APP_BASE_URL`                           | web           | The address shown on the projector and in the class link; the device API refuses a POST from any other origin.             |
| `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` | web           | As for the substitute portal (`docs/phase-3.md`): the per-network throttle of typed codes needs the reverse proxy.         |
| `BULK_MAX_RUN_USD`                       | worker, admin | The most one bulk run may cost at its worst case (default 100, at most 1,000).                                             |
| `SUPABASE_SERVICE_ROLE_KEY`              | admin         | The operator's key for the CLI (coverage, bulk, packs).                                                                    |

Without the class portal settings, « Présenter à la classe » still works and the start dialog
says « Les appareils des élèves ne sont pas configurés sur ce serveur : vous pouvez tout de même
présenter. » Generate the key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### The class portal role's password (deployment step)

The migration creates `lynx_class_portal` without a login; the seed gives it the local-only
password `lynx-class-portal-local-only` (**never use it anywhere else**). On a real database, as
the database owner:

```sql
alter role lynx_class_portal with login password '<a long random secret>';
```

Then set `CLASS_PORTAL_DATABASE_URL=postgresql://lynx_class_portal:<secret>@<host>:5432/postgres`
on the web server only. On hosted Supabase, connect through the pooler with the user name
`lynx_class_portal.<project-ref>`. The role executes the five `class_portal` functions and
nothing else, reads no table, and is kept apart from `lynx_sub_portal` (checked by
`supabase/tests/00_schema_invariants.test.sql`). Where password logins are refused for local
development, connect as `postgres` with `?options=-c%20role%3Dlynx_class_portal` (the pool sets
the statement timeout itself, so it holds either way).

### Class devices (tablets and Chromebooks)

- **Bookmark the class link once per device.** On the class tab, « Lien de la classe » gives the
  link (`…/jouer#k=…`) and its QR code. Open it on each class device (scan the QR code, or « Copier
  le lien » into an e-mail to the class account) and add it to the bookmarks or the home screen.
  From then on the device joins by itself as soon as the teacher opens a lobby. On managed
  Chromebooks and tablets, the board's device management can push the bookmark (a managed
  bookmark or a home-screen shortcut) to every device of a class. « Remplacer le lien » makes the
  old bookmarks stop working (« Ce lien ne fonctionne plus »).
- **Otherwise, the code.** Any browser opens `…/jouer` and types the 6 characters shown on the
  projector.
- **What a device needs:** a recent Chrome, Edge, Firefox or Safari, cookies allowed for the
  site (an HttpOnly cookie holds the device's token for the session), and the school Wi-Fi's
  filter letting short HTTPS requests to the site through (devices poll every 1.5 s; no
  WebSocket and no long-lived stream). About 20 small requests a second for a class of 30.
- **Nothing is typed or stored on the device** beyond the session cookie and a device cookie for
  throttling (30 days, random): no names, no nicknames, no `localStorage`.

### Bulk generation (operator)

Start small (one grade, one subject, two or three types, $25), with the fake provider first:

```bash
pnpm admin bulk-plan --board csc-demo --grade 3 --subject mat --types quiz,worksheet --max-cost 25
pnpm admin bulk-start --run <id>       # the worker sends one batch (usually done within the hour)
pnpm admin bulk-status --run <id>
pnpm admin bulk-report --run <id> [--csv]
pnpm admin bulk-cancel --run <id>      # before it is sent, or to stop waiting
```

`bulk-plan` leaves out what the board already has, prints « pire cas » and « habituel », and how
many requests fit under the cap; running it again later plans only what is still missing. Costs
show in `pnpm admin ai-usage` as « Génération en lot (conseil) ». A real batch needs
`AI_PROVIDER=anthropic`, the key and Mike's go-ahead (one case first: `pnpm ai:eval --feature
library_item --case quiz-5e --batch --yes`, a worst case of about $0.70).

### Content packs (operator and board IT)

`docs/content-packs.md` has the whole procedure: export, transfer, dry run, `--apply`,
`--level-map`, what « modifiée localement », « supprimée localement » and « changée, non
appliquée » mean, undoing an import by archiving, and why pack files are confidential (they hold
answer keys).

```bash
pnpm admin export-pack --board csc-demo --slug lynx-fra-3e --version 2026.2 --title "…" \
  --publisher "IP Lynx" --licence "…" --grade 3 --subject fra --out pack.json
pnpm admin import-pack --board <board> --file pack.json            # dry run
pnpm admin import-pack --board <board> --file pack.json --apply
pnpm admin list-packs --board <board>
pnpm library:pack --version 2026.2 --out dist/lynx-demo-2026.2.json
```

### Load check

`tools/load/class-mode-load.ts` plays one class of simulated devices against a running server
(D-085 has the numbers recorded: 30 devices, poll p95 13 ms and answers 13 ms on `next start` in
this container, no 503; 60 devices, no 503).

## Demo script (5 minutes)

On the classroom computer (1366 × 768 is fine) signed in as Isabelle Tremblay, and one or two
tablets or phones.

1. **Présenter** (1 min). Ressources → search « miroir » → « Pause active : le jeu du miroir » →
   « Présenter à la classe ». → → : « Étape 2 sur … » in big type; « 30 s » starts a visual
   timer. « Quitter la présentation ». Then the demo quiz → « Présenter à la classe » → question 1
   → « Afficher la réponse »: only that answer and its explanation appear.
2. **Start a quiz** (1 min). On « Quiz : les nombres jusqu'à 1 000 », « Lancer un quiz sur les
   appareils »: 3e année, « En équipes », 2 teams, no timer, answers shown → « Lancer ». The
   projector shows « Rejoignez la partie », the code and the QR code.
3. **Join** (1 min). Tablet A scans the QR code (the class link: it joins by itself; bookmark it
   for next time); tablet B opens `/jouer` and types the code in lower case. Each says « Tu es
   l'appareil 1 / 2 » and its team; the projector's tiles count them.
4. **Play** (1.5 min). « Commencer ». Tablet A taps the right answer, B a wrong one: « 2 réponses
   sur 2 ». « Afficher la réponse »: the bars, « Bonne réponse » on the right choice, the
   explanation; A says « Bonne réponse! +100 points », B « Pas cette fois. », neither shows the
   answer. « Question suivante » through the other kinds (true or false, matching, ordering), then
   « Classement ».
5. **End** (30 s). « Terminer » → « Terminer la séance »: « Les réponses des élèves seront
   effacées. », tick « Garder les résultats de la classe (sans noms) » → the class tab shows the
   kept result: % per question, bars and team scores, no device and no name.

Optional: the class tab's « Lien de la classe », « Adapter cette ressource » on a board resource,
« Votre avis », and « Couverture du curriculum » for 3e Mathématiques (Nathalie Roy also sees
« en révision »).

## Data inventory (for the privacy document)

| Data                                                                                      | Holds                                                                                                                                       | Who reads it                                          | Kept                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `class_sessions`                                                                          | class, resource, version, title, options, phase, the question snapshot (no key), join code                                                  | the class team with a teacher role                    | snapshot emptied at the end; closed sessions 30 days               |
| `session_participants`                                                                    | device number, team, SHA-256 of the device token, HMAC of the device cookie, last seen                                                      | nobody through the API; the portal functions          | until the session ends (at most 2 h, plus 5 min)                   |
| `session_responses`                                                                       | the chosen ids or true/false (a short answer is stored as `{}`), score, correct                                                             | nobody through the API                                | until the session ends                                             |
| `class_session_keys`                                                                      | the session's answer key                                                                                                                    | nobody (no API role, not the portal role)             | until the session ends                                             |
| `class_session_results`                                                                   | class counts per question and choice, team scores (no device number, no participant id, nothing typed)                                      | the class team with a teacher role                    | `classModeResultsRetentionDays` (365 by default), or « Supprimer » |
| `class_join_failures`                                                                     | HMAC keys of the device and the network (no raw address), time                                                                              | nobody through the API                                | 1 day                                                              |
| `class_mode_links`                                                                        | the class link token, **in plain text** (the teacher shows it again)                                                                        | the class team, through `class_mode_link()`           | until replaced or the class is deleted                             |
| `library_item_ratings`                                                                    | rater, item, 1–5 stars, dates                                                                                                               | the rater only (averages from 5 colleagues' opinions) | until the rater or the item is deleted; never audited              |
| `library_bulk_runs`, `library_bulk_requests`                                              | board, attentes, types, costs, statuses, the text sent (no personal data, redacted with the board's people)                                 | the operator; reviewers see runs without inputs       | 1 year; the text sent 30 days (then its SHA-256)                   |
| `content_packs`, `content_pack_imports` and `_import_items`, `content_pack_removed_items` | pack header and report; staged items; keys of pack items deleted here (no content, no person)                                               | the operator                                          | staged imports 1 day; the rest with the board                      |
| audit log                                                                                 | `class_session.ended` (counts), `class_mode_link.replaced`, `library_item.remixed`, `.generated`, `.approved`, `.deleted`, bulk runs, packs | the platform (the Phase 6 viewer)                     | 2 years                                                            |

- **Backups.** Deleted rows (answers, devices, keys) remain in database backups and point-in-time
  recovery for the hosting's backup window; PRIVACY.md (Phase 6) must state that window once the
  hosting is chosen.
- **What leaves Canada:** nothing from class mode (it never uses AI). Bulk generation sends
  labels, the operator's note and board-visible titles, redacted with everyone of the board
  (`docs/ai-data-flow.md`); batches are deleted at the provider once read.
- **Nothing a student types is stored**, and devices have numbers, not names (a deviation from
  SPEC §6's « team name or nickname », D-088).

## Security review (slice S8)

- **Portal role and grants:** `lynx_class_portal` executes exactly the five `class_portal`
  functions, reads no table, cannot become or be become by any API role, and is apart from
  `lynx_sub_portal` (pgTAP 00). `anon` executes nothing; `authenticated` cannot use the schema.
  ESLint forbids the portal code from importing library queries, Supabase clients and `@lynx/ai`,
  and a unit test runs ESLint on those paths so the rule cannot be switched off unnoticed.
- **Every path that could carry a key to a device:** the snapshot is a whitelist (no answer
  field; pgTAP 20, 21); since the hardening, option ids carry nothing but the place on screen
  (pgTAP 26); the key table is readable by no API role and not the portal role; every portal
  output of whole sessions is scanned for sentinels planted in every key field (pgTAP 21); the
  web server's Zod parsers strip unknown keys; Playwright scans every `/jouer/api/*` body for
  sentinels and key names and the HTML and RSC payloads for the sentinel values
  (`class-mode.spec.ts`); the device pages load only the `classPortal` messages. The **projector**
  gets the answer only in the reveal phases and only when answers are shown, and since the
  hardening not even how many were right when they are hidden (SQL, schema and screen, tested at
  each level). The **presenter** builds slides on the server from the student content and sends
  one question's answer when asked (`class-mode-present.spec.ts` checks the RSC payload). The
  **kept aggregates** hold counts only. **Packs** hold keys by design: CLI-only, the operator's
  key only, and the guide says they are confidential.
- **Deletion:** ending a session deletes answers, devices, key and snapshot in one transaction
  and audits the counts (pgTAP 20, 21, the e2e checks the tables); an expired session is closed by
  the worker's sweep, and without the worker by the next portal call, projector poll, class tab
  or start (pgTAP 20, `class-mode.int.test.ts`); deleting a class cascades to its sessions.
- **Cost cap:** the worst case per request and the fit under the cap are exact to the
  micro-dollar (`packages/ai/src/batch.ts`, unit tests), `max_cost_usd` is checked in SQL
  (≤ 1,000), and the worker refuses a run above `BULK_MAX_RUN_USD` before sending it
  (`library-bulk.int.test.ts`).
- **Share cap:** enforced by a trigger on every write of `library_items`, and by
  `library_request_approval` (pgTAP 22).
- **Name guard on export:** every prose string of an item, its content and its keys, against the
  board's students and staff, with `--allow-names` for saints and the like (`packs.test.ts`).
- **No content in logs:** a failed portal call logs its SQLSTATE only; the worker logs counts
  (class mode) and ids and codes (bulk); a bulk answer's problem is a code, never text.
- **Review fixes (20261101090500):** per-session option ids; `correctCount` hidden with the
  answers; opinions no longer reveal colleagues' stars; board deletions audited; deleted pack items
  not re-created.
- **axe (WCAG 2 A and AA, serious and critical):** every new page and dialog is checked in the
  browser tests: the presenter (title, steps, safety, question, answer, timer), the projector
  (lobby at every classroom size, question, reveal, ranking, « Appareils », « Terminer la séance »),
  the device pages `/jouer` and `/jouer/partie` (desktop and tablet), the class tab and « Résultats
  gardés », the start dialog, « Adapter » and « Votre avis » (desktop and phone), « Mes
  ressources », result cards, « Couverture du curriculum » (desktop and phone), « Brouillons du
  conseil » and a board draft's page.

## Known limits

- **The real Claude API has not been tried for batches** (only the fake provider). The first real
  run should be one case with Mike's go-ahead; it records the actual-to-worst-case ratio.
- **Opinions with two colleagues acting together:** one can change her stars and the other watch
  the rounded average; the one-day delay limits that to one value a day with nobody else rating.
  A published average of 5 opinions always says something about them.
- **The class link is stored in plain text** (the teacher must show it again): a leaked database
  dump lets someone join that class's lobby while it is open, nothing more; « Remplacer le lien ».
- **Guessing a code:** about 1.4·10⁻⁴ chance an hour per network of reaching one of 20 open
  lobbies, for a device the teacher sees and can remove (D-084); the per-network throttle needs the
  reverse proxy.
- **A long question with six long choices does not fit one 1366 × 768 screen:** the reveal
  scrolls to the right answer, and the teacher scrolls back to the question.
- **No WebKit in this environment:** iPads are to be checked by hand; the browser tests use Chrome
  on an Android tablet and a 1366 × 768 Chromebook-sized window.
- **Pack authenticity:** a checksum is not a signature, and the publisher is self-declared;
  imports stay private until a named reviewer approves them (D-100).
- **Bulk review load:** start with small runs; the reviewers' pace decides the next size.

## Questions for Mike (we built on the recommended answers)

1. **Do pilot classes have tablets or Chromebooks for students?** _Built both: « Présenter à la
   classe » works with only a projector, and devices are optional._
2. **After each quiz question, may the projector show the right answer, and may each device say
   « Bonne réponse » or « Pas cette fois »** (never the answer itself)? _Yes by default; the
   teacher turns both off per session._
3. **Devices get numbers (« Appareil 7 ») and fixed team names instead of nicknames students
   type** (a departure from the spec). _Yes: nothing a child types is stored, and there is nothing
   to moderate._
4. **Bulk AI generation: IP Lynx runs it, with a hard cap per run and costs shown per board,
   outside school budgets?** _Yes; start with $25 runs for 3e and 5e Français and Mathématiques.
   Whether to bill boards for it is yours to decide._
5. **May our content packs for other boards include teachers' approved resources, and how are
   they credited?** _Not by default; with the flag, credited to the board only, never by name,
   until authorship and licensing are agreed (the Phase 4 ownership question)._
6. **May principals rate board-approved resources?** _Yes: opinions are anonymous, limited to
   board-approved resources and shown only from 5 opinions._

Other assumptions are marked **Assumption** in DECISIONS and need no answer now: no speed points
and no timer by default; 2-hour sessions with joining open 20 minutes at a time; balanced random
teams; a team's score is the sum of per-question averages; no individual ranking on the
projector; short answers unscored by default; exit tickets presented but not played on devices;
one version per session; student screens in French (Anglais content in English); class results
kept only as class aggregates, off by default, for a year; class mode in the Library module;
opinions as stars only, on board-approved resources, from 5 (colleagues') opinions, a day old;
adaptations capped at the original's audience; coverage counts board-approved resources linked
directly; no faith reflections or religious education in bulk; pack imports private in the
approval queue; local edits and deletions win over pack updates.

## What to test with a real teacher

1. **Joining.** How long do 20–25 students take with the bookmarked class link versus the typed
   code? Can 1re–3e students type « K7M 4R9 » from the back of the room? Do managed Chromebooks
   keep the bookmark?
2. **Projector readability.** Readable from the back row on a washed-out classroom projector,
   at its real resolution (often 1024 × 768 or 1366 × 768)? Are shapes and letters enough without
   colour? Does the reveal's scrolling to the right answer help or confuse?
3. **Pace and noise.** Without a timer, can she keep the pace? Do students watch the projector or
   their devices? Is « Regarde l'écran » clear?
4. **Teams.** Do random, balanced teams avoid arguments? Is one device per team the usual setup?
   Does the per-question average feel fair? Is « Chacun pour soi » without a public ranking right?
5. **Language levels.** Do ALF and PANA students cope with the base version in a team quiz?
   Should short answers stay unscored by default?
6. **« Présenter » for a pause active, a prayer or an experiment.** Does step by step work? Is the
   « Sécurité » slide useful without her own notes?
7. **Results.** Would she keep class results? Is the % per question useful for the next lesson?
8. **« Adapter ».** Is the word clear? Is the credit line right? Does the sharing limit on an
   adaptation of a colleague's school-shared resource make sense?
9. **« Votre avis ».** Would she give her opinion? Are stars without comments enough? Does
   « pas encore assez pour une moyenne » confuse her, or the day before an opinion counts?
10. **Coverage.** Does it help her, or a principal, find gaps? Are « Aucune / Peu » with a
    threshold clear? Does the difference from browsing counts confuse her?
11. **For a reviewer (bulk).** How many AI board drafts can she review an hour? Is « Approuver
    pour le conseil » in one step safe enough? Is the run's summary line enough?
12. **For a board's IT (packs).** On a test install, are the dry run and its report
    understandable? Is a JSON file by USB key or e-mail acceptable? Are « changée, non appliquée »
    and « supprimée localement » clear?
