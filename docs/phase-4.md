# Phase 4: library core (« Banque de ressources »)

Decisions: `DECISIONS.md` D-061 to D-081 (and the Phase 4 amendments to D-012, D-013, D-030,
D-031, D-038, D-041, D-042, D-046, D-048, D-052 and D-058). What the AI sees:
`docs/ai-data-flow.md`, « Banque de ressources ». How the demo resources are written:
`content/library/README.md`.

## What was built

**For teachers (and the direction who teach)**

- « Ressources » in the navigation (it replaces « Différencier », which moves inside it; the
  phone bar keeps six places and adds « Plus » when needed). The hub has a search field, « Mes
  années d'études », « Parcourir par attente », six categories (« Enseigner », « Pratiquer »,
  « Explorer », « Évaluer », « Jouer », « Relier »), « Mes ressources » and the buttons « Créer
  une ressource », « Créer avec l'IA » (when the school has AI on) and « Texte différencié ».
- **Search** in French with or without accents (« idee principale » finds « idée principale »,
  « 1000 » finds « 1 000 », « B1.2 » finds that attente only), filters with their counts (type,
  category, duration, format, « Pour la suppléance », « Approuvées par le conseil seulement »,
  language level), board-approved resources first, « Afficher plus ». On a phone the filters
  are a bottom sheet. The search stays in the address, and a result's page keeps it for « Retour
  aux résultats ».
- **Browsing by attente:** grade → subject → domaine → attentes, each with « À vérifier » when
  unverified (D-030) and « 3 ressources · 1 approuvée ».
- **« Fiche de la ressource »:** versions per language level (level names on screen only),
  « Pour les élèves », « Guide et corrigé » (the key hidden until « Afficher le corrigé ») and
  « Détails ». « Imprimer » and « PDF »: one version per page with a small number, never a level
  name, never a key on a student sheet; sheets that students fill in start with « Nom : ____
  Date : ____ ».
- **25 resource types** in six categories, each with one editor driven by its schema: questions
  with their answers inline (multiple choice, true or false, matching, ordering, short answer),
  versions per level, safety notes for experiments and STEM challenges, faith content and the
  Catholic link, attentes, tags and keywords. The form is a device draft: nothing is lost on a
  crash, a lost connection or a reload.
- **Workflow:** « J'ai révisé cette ressource » (readiness checklist and originality box),
  « Partager » (school or whole board, with the first-name check), « Proposer au conseil »,
  back to draft, archive, restore, delete. « Mes ressources » groups drafts, « À retravailler »
  (with the reviewer's note), shared and approved resources, and AI requests in progress.
- **Planning:** « Ajouter à ma planification » attaches a resource to the next lesson that shares
  its attente (« Joindre à la leçon 4 »), or adds a lesson plan or project as a new lesson.
  Planification shows the « Ressource » chip, « Joindre une ressource » (which opens the library
  for that lesson) and « Retirer la ressource ».
- **AI (when the school has it on):** « Créer avec l'IA » (a type, grades, subject, attentes,
  levels and an optional faith link; a preview of exactly what is sent, and the approved
  resources that already fit) makes a private draft. « Créer les versions manquantes avec
  l'IA » adds level versions; a reviewed resource becomes a private draft again so its author
  reads them first.
- « Texte différencié » saves an ordinary library draft. A teacher whose school has AI but not
  the Library module still opens, prints and deletes her saved texts.

**For reviewers designated by the board** (a board admin with no school, a consultant, a
principal: whoever the operator designates)

- « Approbation des ressources » with two queues, « À approuver » and « Contenu de foi », and a
  « Décision » panel: approve for the board, send back with a note, faith review, « Signaler du
  contenu de foi », and « Retirer de la banque ». Nobody decides on their own resource. After
  sending back or withdrawing a teacher's resource, the reviewer returns to the queue.

**Substitute plans (Phase 3)**

- Each lesson the substitute teaches gets a resource when one suits it: the lesson's own
  resource if reviewed and safe for a substitute, otherwise the best board-approved one sharing
  an attente. The plan carries the guide for the adult and each group's version for the
  students (never a key). The teacher can take it out (« Ne pas utiliser cette ressource ») and
  bring it back.

**Behind the scenes**

- `@lynx/content`: one versioned schema per type, keys, student projection, grading, the
  document model used by the screen, printing and PDFs, readiness, AI output conversion,
  French typography checks, the seed pack format and curriculum-import validation.
- Library content is written only through database functions; every status change is audited
  with ids only. Search is one database function with the visibility rule written in.
- 78 original demo resources (`content/library/demo`: 29 at the end of Phase 4, 49 more from the
  library expansion), generated into `supabase/seeds/20_library_demo.sql` and linked to the demo
  planning by `supabase/seeds/30_demo_links.sql`.
- A wider curriculum sample for 3e and 5e année in Français, Mathématiques and Sciences et
  technologie (`content/curriculum`, 265 paraphrased attentes, all unverified and shown
  « À vérifier », D-030), generated into `supabase/seeds/10_curriculum_demo.sql` and loaded before
  the demo resources, which link to it.
- Migrations `20261015090000` to `20261015090400`; database tests `15` to `19`.

## How to run it

```bash
tools/lite-stack/stack.sh reset   # or: pnpm db:reset (Supabase CLI); loads the curriculum sample and the 78 demo resources
pnpm dev                          # web app
pnpm dev:worker                   # AI jobs (fake provider by default), plan rebuilds
```

Demo logins (codes in Mailpit, <http://127.0.0.1:54324>): `isabelle.tremblay@demo.lynx.test`
(3e année), `marc.gagnon@demo.lynx.test` (5e année), `nathalie.roy@demo.lynx.test` (board admin,
the demo board's content and faith reviewer), `sophie.lavoie@demo.lynx.test` (principal).

### Reviewers (operator)

Nobody reviews until the board designates someone (a board admin is not a reviewer by
default). The person must be active staff of the board:

```bash
pnpm admin set-library-reviewer --board csc-demo --email nathalie.roy@demo.lynx.test --content true --faith true
pnpm admin list-library-reviewers --board csc-demo
pnpm admin set-library-reviewer --board csc-demo --email nathalie.roy@demo.lynx.test --content false --faith false   # removes
```

The Library module is licensed per school: `pnpm admin set-module --school csc-demo/saint-exemple
--module library --enabled true|false`.

### Demo resources

The pack is `content/library/demo` (`pack.json` and one file per resource, rules in
`content/library/README.md`). After changing it or the curriculum sample:

```bash
pnpm exec vitest run packages/content   # the pack tests: style, names, levels, safety, faith
pnpm library:seed                       # regenerates supabase/seeds/10_curriculum_demo.sql and 20_library_demo.sql
pnpm library:seed:check                 # what CI runs: fails when the SQL is out of date
tools/lite-stack/stack.sh reset         # the seed block stops on any missing reference
```

Never edit `10_curriculum_demo.sql` or `20_library_demo.sql` by hand. The curriculum sample's
files are in `content/curriculum` (rules and the « À vérifier » list in its README). Resource ids
are UUIDv5 of `demo/<slug>` under a fixed namespace: renaming a slug makes a new resource.

### Curriculum import

JSON only, one subject's curriculum version per file (`curriculumFileSchema`; example
`tools/fixtures/curriculum-sample.json`). A dry run unless `--apply`; strands and attentes are
upserted by code, never deleted, and every search document is rebuilt:

```bash
pnpm admin import-curriculum --file tools/fixtures/curriculum-sample.json            # what would change
pnpm admin import-curriculum --file tools/fixtures/curriculum-sample.json --apply    # writes it
```

A file that says `"official": true` or `"verified": true` is refused without
`--confirm-licence`, which prints the licensing warning (D-030, D-070): official Ministry text
and the Catholic graduate expectations need permission before they go into the product.

### AI evaluation

`pnpm ai:eval --feature library_item --provider fake` and `--feature library_levels --provider
fake` run free. With the real API (key set and Mike's go-ahead), try one case first (under $1),
then both sets (about $3–5).

## Demo script (5 minutes)

1. **Find (1 min).** As Isabelle on a phone: « Ressources » → type « huard ». The results show
   « Le huard, oiseau des lacs » first (« Approuvée par le conseil », « Suppléance », « 4
   niveaux »). « Filtres » → « Pour la suppléance ». Open the resource: « Débutant » changes the
   text; « Guide et corrigé » keeps the key hidden until « Afficher le corrigé ».
2. **Print (30 s).** « Imprimer » → « Pour les élèves »: five pages, a small number in the
   corner, never « Débutant », a « Nom » line, no key.
3. **Plan (30 s).** « Ajouter à ma planification »: 3e année, Français and « Leçon 4 (prochaine
   leçon) » are already chosen → « Joindre à la leçon 4 ». Planification shows the chip.
4. **Browse (30 s).** « Parcourir par attente » → 3e année → Français → C1.2: « À vérifier », the
   count, and the same results.
5. **Write and share (1 min).** « Créer une ressource » → « Billet de sortie »: two questions with
   their answers, a grade, the subject, an attente, a duration. « J'ai révisé cette
   ressource », then « Partager » → « Avec mon école ». Type a student's first name (« Samuel ») in a
   question first to show the first-name check.
6. **Review (1 min).** As Nathalie: « Approbation des ressources » → « Billet de sortie : les
   fractions équivalentes » (Marc's). The checklist, then « Approuver pour le conseil ». Show
   « Contenu de foi » and « Retirer de la banque ».
7. **Substitute plan (30 s).** As Isabelle: « Je suis absent·e » for a day with 3e Français
   lesson 4 → « Réviser le plan »: « Ressource de la banque : Le huard… », each group's version,
   « Voir le corrigé » for her only, and « Ne pas utiliser cette ressource ».

With AI on (fake worker in development): « Créer avec l'IA » → « Fiche d'exercices », 3e,
Mathématiques, B1.2, the four levels → « Vérifier avant d'envoyer » → « Envoyer »: a private
draft « Brouillon créé par l'IA : relisez-le… ».

## Data inventory (for the privacy document)

| Data                                                        | Where                                                       | Who                                                                                                                         | Kept                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Resources: title, summary, keywords, materials, links       | `library_items`, `_grades`, `_expectations`, `_tags`        | D-065 (author, school or board staff by sharing, reviewer)                                                                  | until deleted by its author (or archived)  |
| Content per version, answer keys                            | `library_item_versions`, `library_item_answer_keys`         | same, but keys only for the author, reviewers, teachers and the direction (D-149); never on student sheets, plans or search | with the resource                          |
| Review state: request, decision, reviewer's note            | `library_items` (`review_*`, `approved_*`, `faith_*`)       | author, the board's reviewers                                                                                               | with the resource (the note until changed) |
| Reviewer designations (user, content, faith)                | `library_reviewers`                                         | board staff (read); the operator writes                                                                                     | until removed                              |
| Search document (title, summary, keywords, attentes, text)  | `library_items.search_document`                             | nobody reads it directly; search returns usable items only                                                                  | rebuilt on every change                    |
| Resource links in planning, usage count                     | `unit_lessons.library_item_id`, `library_items.usage_count` | the teacher; the count is on the resource                                                                                   | with the lesson                            |
| AI requests (ids and choices, the input the database built) | `ai_jobs` (input, answer, exact text sent)                  | the requester                                                                                                               | 30 days (`AI_JOB_RETENTION_DAYS`)          |
| AI provenance (prompt version, model, usage row)            | `library_items`, `ai_generations`                           | the author; usage rows hold no text                                                                                         | with the resource; usage rows kept         |
| Snapshots of a resource in a substitute plan (no key)       | `sub_plans.plan`                                            | D-056                                                                                                                       | with the plan (1 year, D-059)              |
| Workflow audit (ids, scope, counts; never notes or titles)  | `audit_log`                                                 | Phase 6 viewer                                                                                                              | 2 years                                    |

Resources hold no student data by design: the first-name check runs before sharing, and AI
content may contain no « Élève A » marker (D-066, D-072). A teacher's private drafts can hold
names she typed; nobody else reads them, board admins included. PDFs are never stored.

## Security review (slice S10)

- **Functions that take a user** (`app.library_item_usable_by`, `_readable_by`,
  `_editable_by`, `app.library_reviewer`, `app.library_board_staff`, `app.sub_plan_library_sources`
  …) run for the service role only; `authenticated` reaches the library through the `public`
  functions, each checking the current user. Checked on the database: the only function taking a
  user that `authenticated` may run is Phase 1's `app.is_teacher_at_class_school`.
- **Direct writes are closed:** `authenticated` has `select` on the library tables and `delete`
  on `library_items` (drafts, sent back, archived; row level security), nothing else
  (`00_schema_invariants`). The one exception was Phase 1's `library_item_ratings` (a user's own
  rating, under row level security); since Phase 5 (D-093) opinions too are written only through
  a function, `rate_library_item`, which checks who may give one (`00_schema_invariants`).
- **Visibility (D-065) regression:** board admins no longer read private drafts (tests 06, 07,
  15); search is pinned to `app.library_item_usable_by` (test 17); office staff have no library
  pages or PDFs (e2e).
- **Answer keys:** read by the item page's « Guide et corrigé », the teacher print and PDF, and
  the editor only. Student sheets (`loadItemForStudentSheet`, `renderStudentDoc`) never read the
  key table; substitute plans only learn whether a key exists; search never indexes keys. Since
  D-149 (`20270210090200_answer_keys_office.sql`, test 41), row level security gives keys to the
  author, the board's reviewers, and the teachers and direction the sharing reaches. Office and
  facilities staff, and board admins who are not reviewers, read shared resources without their
  keys; « Adapter » copies keys only for someone who may read them.
- **First-name check:** runs on the web server before sharing, proposing and saving a shared
  resource; personal details always block (D-066).
- **Audit:** every workflow step and designation is audited with ids, scope and counts; notes,
  titles and names never are (test 15). Worker logs carry job ids, status, cost and problem
  paths, never content.
- **Review fixes (20261015090400):** an edit can no longer leave faith content on the whole
  board without a faith review; AI versions return a reviewed resource to a private draft; an
  author who left the board can no longer edit, propose or widen the sharing of her resources.

## Known limits

- **The real Claude API has not been tried** for « Créer avec l'IA » or « Créer les versions
  manquantes » (only the fake provider): the evaluation needs a key and Mike's go-ahead.
- **Readiness in SQL and in the app:** the database checks presence (grades, attentes, key,
  levels, safety); the content schema and the key's completeness are checked by the app. An API
  caller could mark reviewed a resource whose content fails `final`; the renderer copes.
- **The first-name check knows the teacher's own students only.** A parent's name, or a student
  of another school, is caught only by the author's review.
- **Faith content depends on the author's checkbox**, the keyword suggestion and reviewers'
  « Signaler du contenu de foi ». Sharing with the school stays under the teacher's authority.
- **Math has no drawings** (number lines, grids) until visual blocks exist (Phase 5).
- **Substitute plans:** a resource changed between reading and publishing shows at the next
  rebuild; days that can no longer change do not count for « once per absence » (D-077).
- **Licences:** every demo resource's `licence` is empty until question 5 below is answered.

## Questions for Mike (we built on the recommended answers)

1. **Who approves resources for the board, and who reviews faith content?** _Built: the board
   names one or two people (a pedagogical consultant for content; the chaplaincy lead or a
   principal for faith), set with the admin tool. For the pilot, a lead teacher you trust._
2. **May teachers share their own reviewed resources with their school or the whole board before
   board approval?** _Built: yes, with « Révisée » visibly different from « Approuvée par le
   conseil ». Faith content reaches the whole board only after its faith review._
3. **May the AI draft short prayers and faith reflections?** _Built: yes, always marked as faith
   content, always editable, and faith-reviewed before it reaches the whole board._
4. **Should the AI create the four language-level versions by default** (about 3–4 times the
   cost, ≈ $0.30–0.60 per resource)? _Built: yes for student sheets; the teacher can untick it._
5. **Who owns what teachers share?** _Recommended: the teacher keeps the credit; the board may
   use shared resources within the board; IP Lynx does not resell teacher content without a
   separate agreement. To confirm with a lawyer before selling content packs. Licences are left
   empty until then._
6. **May we show pilot teachers our 78 demo resources** (written by us, original, labelled
   « Démonstration ») until real ones replace them? _Built: yes._

Assumptions that need no answer now (in DECISIONS as **Assumption**): board admins are not
reviewers automatically; faith review is needed for board approval and board-wide sharing, not
for school sharing; attentes are optional for pauses actives, réflexions catholiques, amorces
culturelles and chansons; level versions are required for board approval of reading passages,
worksheets, exit tickets and quizzes; office staff have no library screens; faith links are off
by default when generating; approved resources are read-only and reviewers can withdraw them;
substitute plans never carry keys; materials attach to an existing lesson and lesson plans become
a new lesson; the usage count is « nombre d'unités qui l'utilisent »; tags are a curated list
and teachers add free keywords; approvals do not rebuild substitute plans, withdrawals do.

## What to test with a real teacher

1. **Finding things.** Ask her to find something for tomorrow's lesson in her own words
   (« idée principale », « fractions »). Do the results make sense? Are the filters clear on a
   phone?
2. **Browsing by attente.** Is grade → subject → domaine → attente how she thinks? Is « À
   vérifier » clear?
3. **Resource quality.** For five demo resources (the huard, the ordering worksheet, the quiz,
   the experiment, the rubric): is the French natural for Ontario schools, right for the age,
   usable as is? What is missing?
4. **Printing.** Are the student sheet and the teacher copy readable, and right to be separate?
   Is the small number acceptable instead of level names? Is the « Nom » line where she wants
   it?
5. **Language levels.** Are the four versions of « Le huard » different enough, with the same
   intention d'apprentissage? Would she hand them out?
6. **Creating by hand.** Build a quiz with each question kind on a laptop, then on a phone. How
   long does it take? Where does she get stuck?
7. **AI generation** (if AI is on). How long, how good, how much does she fix? Is the preview
   reassuring? Does « Des ressources approuvées existent déjà » change what she does?
8. **Review and sharing.** Is « J'ai révisé cette ressource » meaningful or a formality? Is the
   originality box acceptable? Is the first-name check helpful or annoying?
9. **Planning.** Is « Joindre à la leçon 4 (prochaine leçon) » the right default for a worksheet?
   Is « À la fin de l'unité » right for a lesson plan?
10. **Substitute plan.** With « Le huard » in her plan, would a substitute run the period with the
    group sheets and without the corrigé?
11. **Faith.** Are the suggested references right for the topic and grade? Is the connection
    sentence respectful and modest? Is « Contient du contenu de foi » clear?
