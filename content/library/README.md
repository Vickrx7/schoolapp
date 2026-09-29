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
`csc-demo`. It has 29 original items in Canadian French, with at least 3 in each of the six buckets
and 24 global tags. Seven items have a version for each of the four board levels: the six approved
reading passages, worksheets, exit ticket and quiz, plus Marc's exit ticket.

- Most items are `board_created` and approved by the content reviewer
  (`nathalie.roy@demo.lynx.test`). The Catholic reflection is also faith-reviewed.
- A few items belong to Isabelle (3e) or Marc (5e) to show the workflow:
  - reviewed and shared with the school;
  - shared with the board;
  - an AI-generated draft (`comparer-des-nombres-brouillon`);
  - an exit ticket waiting in the reviewer's queue (`billet-fractions-equivalentes`).
- Item `ordonner-nombres-1000` is linked to 3e MAT lesson 5 by the Phase 4 seed.

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
  block. The block looks up every reference by code and raises an error if one is missing. The
  `pnpm library:seed` script and the generated `supabase/seeds/20_library_demo.sql` come with the
  Phase 4 library migration.
- **Formatting:** item files are formatted with Prettier, like the rest of the repository.

## Checking a change

```bash
pnpm exec vitest run packages/content    # includes seed-pack.test.ts (plan tests 49–55)
pnpm exec prettier --check content
```

`packages/content/src/seed-pack.test.ts` reads every file in this pack, plus `supabase/seed.sql`,
and checks the following:

- **Validity:** every item parses in `final` mode and its answer keys are valid.
- **French style:** every French string passes `frenchStyleProblems`:
  - no straight apostrophes;
  - no « 3ème »;
  - no CP, CE1… or `NOT_CANADIAN` words;
  - non-breaking spaces inside « » and before `:`.
- **The pack as a whole:**
  - it has 29 items, at least 3 per bucket, with unique slugs and ids;
  - every tag is defined, and the pack converts to SQL;
  - every attente exists in the seeded curriculum. The four planned 5e Français codes from plan C5
    are allowed until they are added to `seed.sql`.
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

The test expects exactly 29 items. Adding or removing an item means updating that number on
purpose.

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

- Fictional characters take their first names from the AI prompt's name pool (plan E3): Alix,
  Bastien, Capucine, Désiré, Éloïse, Fabien, Gaëlle, Inès, Jules, Laurier, Noé, Océane,
  Raphaëlle, Yanis.
- **Never use a seed student's first name.** Hugo and Maëlle are in the prompt's pool, but they
  are also seed students, so the pack does not use them. The test reads the current student names
  from `supabase/seed.sql`.
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
- **Attentes:** existing codes only. Never invent a code.
  - Brain breaks, Catholic reflections, culture hooks and songs may have none.
  - The seeded attentes are paraphrased and marked « À vérifier » (D-030).
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
4. Once the Phase 4 migration is in, regenerate the SQL seed with `pnpm library:seed`.
