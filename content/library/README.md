# Library content packs

This folder holds library content packs (DECISIONS D-071 and D-081). A pack is a
folder with a `pack.json` manifest and one JSON file per item in `items/`. Today there is one pack,
`demo`. In Phase 4 it becomes the demo library seed (D-031), and later it will be the format for
exporting and importing packs for board-hosted installs (SPEC §9.3).

```
content/library/
  README.md          this file: format and writing rules
  demo/
    pack.json        the manifest: slug, version, title, publisher, board, tags, item order
    items/<slug>.json
```

## The demo pack

« Ressources de démonstration (à valider en classe) », version `2026.1`, for the demo board
`csc-demo`. It has 81 original items in Canadian French and 37 global tags. The depth is in 3e and
5e année, in Français, Mathématiques and Sciences et technologie (SPEC §9.3, « depth before
breadth »):

| Subject                 | 3e  | 5e  | Several grades                                             |
| ----------------------- | --- | --- | ---------------------------------------------------------- |
| Français                | 17  | 9   | 2: a song, a culture hook                                  |
| Mathématiques           | 18  | 15  | none                                                       |
| Sciences et technologie | 5   | 7   | 1: a brain break                                           |
| Other subjects          |     |     | 6: 2 EPS brain breaks, an arts culture hook, 3 reflections |
| No subject              |     |     | 1: the learning-skills comment bank (3e and 5e)            |

- **Buckets:** Enseigner 9, Pratiquer 26, Explorer 13, Évaluer 10, Jouer 14, Relier 9.
- **Levels:** 19 items have a version for each of the four board levels: the 18 approved reading
  passages, worksheets, exit tickets and quizzes, plus Marc's exit ticket.
- **Workflow:**
  - 60 items are `board_created` and approved by the content reviewer
    (`nathalie.roy@demo.lynx.test`). The three Catholic reflections are also faith-reviewed.
  - Three of them are report card comment banks (« Banque de commentaires de bulletin », D-129):
    `commentaires-mat-3e-bulletin` (bulletin scolaire, by achievement level),
    `commentaires-fra-3e-progres` (bulletin de progrès, by progress mark) and
    `commentaires-habiletes` (the six learning skills by rating, no subject). Their entries use
    `{prénom}` for the student's first name, neutral (épicène) wording first, and the achievement
    chart's qualifiers; like everything here, they are to be checked in class.
  - 21 items belong to Isabelle (3e), Marc (5e) or Paul Leblanc (EPS) to show the workflow:
    reviewed and shared with the school, shared with the board, private drafts (five of them
    AI-generated, such as `comparer-des-nombres-brouillon`), and three items waiting in the
    reviewer's queue (`billet-fractions-equivalentes`, `atelier-carte-postale`,
    `coeur-apres-effort`).
- Item `ordonner-nombres-1000` is linked to 3e MAT lesson 5 by the Phase 4 seed.
- **Attentes:** the items link to attentes of the curriculum sample in `content/curriculum` (105
  links to 88 codes). Most of those codes are not in `supabase/seed.sql`, so **the curriculum
  sample loads first**: `supabase/seeds/10_curriculum_demo.sql`, generated from those files, runs
  before the pack's SQL (`20_…`), whose `DO` block stops on the first missing attente. Every
  attente stays paraphrased and unverified (D-030), shown « À vérifier ».

Every item is written to be read by a teacher before it is used in a class (plan J3), which is why
the pack's title says « à valider en classe ».

## Format

- **Schemas:** `seedPackSchema` and `seedItemSchema` in `packages/content/src/seed-pack.ts`.
  - Each version's `content` follows its type's schema in `final` mode
    (`contentSchema(type, 'final')`).
  - Each answer key follows `answerKeySchema('final')` and must pass `validateAnswerKey`.
- **References are by code,** never by database id:
  - board and school slugs;
  - user e-mails;
  - subject, grade and attente codes (`{ "grade": "3", "code": "C1.2" }`);
  - level codes;
  - Catholic reference titles;
  - tag slugs.
- **Tags:** every tag an item uses must be defined in `pack.json`.
- **File names:** the file name is the slug (`items/<slug>.json`, lowercase words joined by
  hyphens). The database ids are UUIDv5 values of `demo/<slug>`, so **never rename a slug once it
  has shipped**: seeds and lesson links point at those ids.
- **Load order:** `pack.json` lists every item once, in load order. `packToSql` refuses a pack
  whose list and files differ.
- **To SQL:** `packToSql` (`packages/content/src/seed-sql.ts`) turns the pack into one SQL `DO`
  block. The block looks up every reference by code and raises an error if one is missing.
  `pnpm library:seed` (`tools/build-library-seed.ts`) writes it to
  `supabase/seeds/20_library_demo.sql`, which is committed, and writes the curriculum sample to
  `supabase/seeds/10_curriculum_demo.sql` (`curriculumToSql`). Database resets load
  `supabase/seed.sql`, then `supabase/seeds/*.sql` in name order (`sql_paths` in
  `supabase/config.toml`, and `tools/lite-stack/stack.sh`): the curriculum sample, the pack, then
  `30_demo_links.sql`, which links `ordonner-nombres-1000` to 3e MAT lesson 5. Loading the pack
  again does nothing: the block stops when the pack's version is already there.
- **Formatting:** item files are formatted with Prettier, like the rest of the repository.

## Checking a change

```bash
pnpm exec vitest run packages/content    # includes seed-pack.test.ts (plan tests 49–55)
pnpm exec prettier --check content
pnpm library:seed                        # regenerate supabase/seeds/10_… and 20_…_demo.sql
pnpm library:seed:check                  # CI: fails when the SQL no longer matches its files
```

After a database reset, `pnpm test:int` also runs `packages/content/src/seed.int.test.ts`: every
seeded item must match its file and pass the database's own readiness rules, and every attente of
the curriculum files must be in the database.

`packages/content/src/seed-pack.test.ts` reads every file in this pack, plus `supabase/seed.sql`
and the curriculum files in `content/curriculum`, and checks the following:

- **Validity:** every item parses in `final` mode and its answer keys are valid.
- **French style:** every French string passes `frenchStyleProblems`:
  - no straight apostrophes;
  - no « 3ème »;
  - no CP, CE1… or `NOT_CANADIAN` words;
  - non-breaking spaces inside « » and before `:`.
- **The pack as a whole:**
  - it has 81 items, at least 3 per bucket, with unique slugs and ids;
  - every tag is defined, and the pack converts to SQL;
  - every attente exists in the seeded curriculum of `seed.sql` or in a curriculum file of
    `content/curriculum`, for one of the item's grades. `seed.sql` includes four 5e Français
    attentes added for this pack (C1, C1.2, D1, D1.1, with the same meanings as the 3e codes).
- **The curriculum files:**
  - every file passes `parseCurriculumFile` without `--confirm-licence` (paraphrases only, D-030);
  - one subject and grade per file, named after its version and grade (`mat-2020-3e.json`), and
    the same strands in both grades of a subject;
  - their French passes `frenchStyleProblems`;
  - together they hold every attente of `seed.sql`, with the same kind, strand, parent and
    wording (only the typography may differ).
- **Levels:**
  - approved reading passages, worksheets, exit tickets and quizzes have all four board levels;
  - every version keeps the base version's objective;
  - assessments keep the same questions and question kinds at every level;
  - no student sheet names a level.
- **Safety:**
  - experiments and STEM challenges have complete safety notes;
  - anything with elastic bands says « sans latex »;
  - a sub-friendly experiment has `standard` supervision.
- **Faith:**
  - any item with faith words sets `faithContent`;
  - approved faith content is faith-reviewed;
  - rubrics use the achievement chart qualifiers (`rubricWordingProblems`).
- **Names and quote tags:** no string contains a seed student's first name (read from
  `seed.sql`), `$lynxpack$` or `$lynxseed$`.
- **Readiness:** reviewed and approved items pass `reviewReadiness`, with no warning other than
  « Version de base seulement ».

The test expects exactly 81 items, and a fixed number of approved items per type that need levels.
Adding or removing an item means updating those numbers on purpose.

## Writing rules

These rules apply to every string students, families or teachers will see, including teacher
notes, answer keys, materials and summaries.

### Original work only

- Write everything for this pack. Never copy or closely paraphrase textbooks, Teachers Pay
  Teachers, Idéllo, websites or any other third-party material.
- Do not quote copyrighted text.
- The pack has no images (Phase 4 has none). « Appuis visuels » are text suggestions for the
  teacher.

### Canadian French, as used in Ontario French-language schools

- Use Ontario curriculum terms: attentes, contenus d’apprentissage, domaines.
- Write grades as « 3e année », « 1re année », never « 3ème » or « CE2 ».
- Use Canadian vocabulary: « fin de semaine », « courriel », « autobus », « dîner » (at noon),
  « gomme à effacer », « la personne suppléante », « la direction ».
- Avoid expressions specific to France (« week-end », « septante », CP/CE/CM grade names) and
  anglicisms.
- Write for the age of the grade. Check vocabulary and sentence length.

### Typography

- Always use the typographic apostrophe `’`, never `'`.
- Put a non-breaking space (U+00A0) inside « » (« comme ceci ») and before `:`.
- Put a non-breaking space inside numbers and before units and symbols: « 1 000 », « 7 $ »,
  « 25 ¢ », « 30 cm », « 0,5 L ».
- Use a decimal comma: « 0,75 ».
- Put no space before `?`, `!` or `;` (Canadian usage).
- The English half of a family guide follows English conventions: « 1,000 », « $7 », “ ”.

### Neutral, inclusive wording

- Address the student as « tu » on student sheets and the teacher as « vous » in teacher notes.
- Prefer words that cover everyone: « les élèves », « le personnel », « la personne
  suppléante », « les familles », « votre enfant ».
- Use doublets when a gendered word is needed: « les Franco-Ontariens et les
  Franco-Ontariennes », « l’enseignante ou l’enseignant ». Use the middle dot only when nothing
  else works.
- Welcome every family and every home language. Make no assumptions about who is at home.

### Characters

- Fictional characters take their first names from the AI's name pool (`CHARACTER_NAMES` in
  `packages/ai/src/features/library-shared.ts`): Alix, Bastien, Capucine, Désiré, Éloïse, Fabien,
  Gaëlle, Inès, Jules, Laurier, Noé, Océane, Raphaëlle, Yanis.
- **Never use a seed student's first name.** The plan's list also had Hugo and Maëlle, but they
  are seed students, so neither the pool nor the pack uses them. The test reads the current
  student names from `supabase/seed.sql`.
- Never use person markers such as « Élève A ». Library content is reusable, so it names no real
  student.
- Real public figures appear only when the text is about them (for example, the creators of the
  Franco-Ontarian flag), and their facts are listed for checking.

### Facts

- Check every fact you can: dates, measurements, animal facts, history.
- Anything a teacher should confirm goes in `factsToVerify` (culture hooks) or in the
  `teacherNote`, as a short list.

### Songs

- Songs use only public-domain tunes (« Frère Jacques », « Au clair de la lune », « Alouette »…).
- Name the tune in `tune` (« Sur l’air de … »).
- Lyrics are original and fit the tune's syllables.

### Mathematics without drawings

- There are no images or math drawings until visual blocks exist (Phase 5).
- Describe models in words: paper folding, base-ten blocks, money, a number line described in text
  (« Sur une droite numérique de 0 à 1 000… »).
- Check every answer by hand.

### Language levels

- Use the board levels only: `debutant`, `intermediaire`, `avance`, `enrichi`.
- Every version has the same `objective` as the base version, word for word.
- Assessments (exit tickets, quizzes) keep the same question ids, kinds and correct answers at
  every level. Only the wording, hints and glossary change.
- Other types may add hints (the most accessible level) or extension questions (Enrichi).
- Never show a level name to students. It may appear only in `teacherNote`.
- Approved reading passages, worksheets, exit tickets and quizzes need all four levels.
  Other types may have a base version only.

### Answer keys

- Every question has an entry in the version's `answerKey`.
- Every short answer has a sample answer and, when possible, accepted answers.
- Store ordering items and the right-hand column of matching questions scrambled, never in answer
  order.
- Answers never appear in student-facing fields. Teacher-only fields (`teacherNote`, `setup`,
  `visualSupports`…) hold nothing students need.
- Expected results of an experiment and the solution of a weekly challenge go in
  `answerKey.solution`.
- Substitute plans never carry answer keys.

### Safety (experiments and STEM challenges)

- Complete `safetyNotes`: age suitability, allergy-aware materials, a supervision level and the
  hazards.
- Use latex-free elastic bands and balloons (« sans latex ») and no food allergens (nuts, peanuts,
  seeds).
- `supervision: "standard"` only when any adult without special training can run the activity
  safely. Only those experiments and STEM challenges may be sub-friendly.

### Faith content

- Keep it short, respectful and right for the age.
- Give a biblical reference only (« Genèse 2, 15 »), never a quotation.
- Prayers are original.
- Set `faithContent` whenever an item contains prayer or religious text.
- Tie a Catholic reflection to a seeded `catholic_references` title (`catholicReference`).
- Faith content shared with the whole board must be faith-reviewed (`faithReviewed`, D-064).

### Metadata

- **Grades:** at most 4.
- **Attentes:** existing codes only, from `supabase/seed.sql` or `content/curriculum`. Never
  invent a code.
  - Brain breaks, Catholic reflections, culture hooks and songs may have none.
  - The seeded attentes and the curriculum files are paraphrased and marked « À vérifier »
    (D-030). An item linked to a code on the curriculum README's « À vérifier » list changes with
    it if the code is renumbered.
- **Duration and materials:** always set. Write « Aucun matériel particulier » when there is
  nothing to prepare.
- **Tags and keywords:** tags from `pack.json`, plus free keywords.
- **Formats:** `interactive` stays `false` until class mode exists (Phase 5).
- **Sub-friendly items:** complete instructions and common materials. A sub-friendly lesson plan
  has `subNotes`.
- **Workflow:**
  - Board items are `board_created`, with no author, and approved by the content reviewer.
  - Teacher items give the author's e-mail and, when shared with the school, the school slug.

## Adding an item

1. Write `items/<slug>.json` and add the slug to `items` in `pack.json`. Add any new tag to `tags`.
2. Run the checks above, and update the item count in `seed-pack.test.ts`.
3. Have a teacher read it. Faith content also needs the faith reviewer.
4. Regenerate the SQL seed with `pnpm library:seed` and commit it with the item. Databases pick
   the change up at their next reset: loading the seed where the pack is already loaded does
   nothing.
