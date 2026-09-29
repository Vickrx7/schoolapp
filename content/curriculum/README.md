# Curriculum sample (import files)

This folder holds a wider curriculum sample for the demo: 3e and 5e année, in Français,
Mathématiques and Sciences et technologie. Each file follows the curriculum import format
(DECISIONS P-10 and D-030) and can be loaded with the curriculum import command.

**This is not the Ministry's text.** Every entry is a short summary, paraphrased in Canadian French
for the demo. Every file says `"official": false` and `"verified": false`, so every row loads with
`is_verified = false` and shows « à vérifier » in the app. The codes are the ones the entries
correspond to in the Ontario curriculum, as far as we know. The uncertain ones are listed below
under « À vérifier ».

```
content/curriculum/
  README.md           this file: format, rules and the « À vérifier » list
  fra-2023-3e.json    Français (2023), 3e année
  fra-2023-5e.json    Français (2023), 5e année
  mat-2020-3e.json    Mathématiques (2020), 3e année
  mat-2020-5e.json    Mathématiques (2020), 5e année
  sci-2022-3e.json    Sciences et technologie (2022), 3e année
  sci-2022-5e.json    Sciences et technologie (2022), 5e année
```

| File               | Subject | Grade | Strands | Attentes | Contenus | Total |
| ------------------ | ------- | ----- | ------- | -------- | -------- | ----- |
| `fra-2023-3e.json` | `fra`   | 3     | A–D     | 12       | 32       | 44    |
| `fra-2023-5e.json` | `fra`   | 5     | A–D     | 12       | 32       | 44    |
| `mat-2020-3e.json` | `mat`   | 3     | A–F     | 12       | 34       | 46    |
| `mat-2020-5e.json` | `mat`   | 5     | A–F     | 12       | 33       | 45    |
| `sci-2022-3e.json` | `sci`   | 3     | A–E     | 11       | 32       | 43    |
| `sci-2022-5e.json` | `sci`   | 5     | A–E     | 11       | 32       | 43    |

Every overall attente (attente) of each subject and grade is there. Contenus d’apprentissage
(specific expectations) cover the most-used ones, not all of them.

## Format

- **Schema:** `curriculumFileSchema` in `packages/content/src/curriculum-import.ts`. One file
  per subject and grade.
- **Codes:**
  - Strands (domaines) are letters: `A`, `B`…
  - Overall attentes are `B1`, `C2`… with `"kind": "overall"` and `"parentCode": null`.
  - Contenus d’apprentissage are `B1.1`, `C2.3`… with `"kind": "specific"`. Their `parentCode` is
    their overall attente and their `strandCode` is the code's letter.
- **Order:** each attente is followed by its contenus, in code order. The strands are in
  curriculum order.
- **Strands:** both grade files of a subject list the same strands, with the same labels. The
  labels and order match `supabase/seed.sql`. The import upserts strands by subject, version
  and code.
- **Versions:** `fra-2023`, `mat-2020` and `sci-2022`, as in the seed.
- **Language:** French only. `textEn` and `labelEn` are `null`: curriculum strands stay French
  (D-033).
- **`sourceNote`:** a short French note for teachers, saying that the text is a paraphrase to
  check against the official document.
- **Formatting:** the files are formatted with Prettier, like the rest of the repository.

## Relationship with the seed and the demo pack

- **Superset of the seed:** the files contain every attente seeded in `supabase/seed.sql`. That
  means 18 rows, for 3e FRA and MAT, and 5e MAT and SCI. Each keeps its code, kind, strand,
  parent and wording. Only the typography changes: `’`, and a non-breaking space in « 1 000 ».
- **Planned codes:** `seed-pack.test.ts` allows four planned 5e Français codes until they are
  seeded (plan C5): C1, C1.2, D1 and D1.1. They are here, with the same meanings as the 3e codes.
  5e C1.1 and C1.3 were added with the 3e meanings too.
- **Demo pack links:** every attente that a demo pack item links to exists in these files (107
  links to 90 codes). Most of those codes are not in `supabase/seed.sql`, so the demo pack's SQL
  can only load once these files are imported.
- **Strand label:** importing these files rewrites the seeded Français strand labels with a
  non-breaking space before `:` (« Compréhension : … »). The seed has an ordinary space there.

## Writing rules

- **Paraphrase only.** Write one short sentence that starts with a verb in the infinitive
  (« Comparer et ordonner… »). Never copy or closely follow the Ministry's wording. Official
  text needs a licence (D-030).
- **Never invent a code.** Add a code only when you are reasonably confident that it exists with
  that meaning. When in doubt, leave the code out: gaps in the numbering are deliberate. Add a
  line under « À vérifier » for every code whose number or scope is uncertain.
- **Never renumber a seeded code** in these files alone. Demo pack items, and later lessons and
  units, link to attentes by code. A renumbering needs a coordinated change to the seed, the
  items and any existing links.
- **Canadian French:** follow the Ontario French-language school usage and the typography rules
  in `content/library/README.md`. That means:
  - `’`, never `'`;
  - non-breaking spaces inside « » and before `:`, and in « 1 000 » and « 100 $ »;
  - no space before `;`, `?` or `!`;
  - no Europeanisms;
  - neutral wording or doublets (« ce qu’elle ou il lit », « des autrices et des auteurs »).
- **Official terms:** use the Ontario terms: attentes, contenus d’apprentissage, domaines,
  suites, nombres naturels, disposition rectangulaire, processus de design en ingénierie,
  métiers spécialisés, Premières Nations, Métis et Inuit.

## Checking a change

```bash
# Every file parses (an empty array means no errors):
pnpm exec tsx -e "import { readFileSync, readdirSync } from 'node:fs'; import { parseCurriculumFile } from './packages/content/src/curriculum-import'; for (const f of readdirSync('content/curriculum').filter((f) => f.endsWith('.json'))) console.log(f, parseCurriculumFile(readFileSync('content/curriculum/' + f, 'utf8')).errors);"
pnpm exec vitest run packages/content/src/seed-pack.test.ts
pnpm exec prettier --check content
```

These files were first checked with a one-off script. The script did the following:

- It ran `parseCurriculumFile` on every file.
- It ran `frenchStyleProblems` on every string, and checked for straight apostrophes and for
  breaking spaces in numbers or before `$`.
- It checked each file's name against its subject, version and grade, and the parents and strands.
- It checked that the files are a superset of the seeded attentes.
- It checked that the planned codes and the demo pack links exist.

`packages/content/src/seed-pack.test.ts` now keeps most of those checks: every file parses
without `--confirm-licence`, one subject and grade per file with a matching name, the same strands
in both grades of a subject, the French style, the seeded and planned codes, and every attente a
demo pack item links to. The parents and strands are checked by `parseCurriculumFile` itself.

## Loading

`pnpm admin import-curriculum` validates a file with `parseCurriculumFile` and applies it. The
header of `curriculum-import.ts` describes it, and it is a dry run unless you pass `--apply`.

- Never pass `--confirm-licence` for these files: they are paraphrases, not official text.
- Load them only once the reviewer has gone through « À vérifier ».
- Load them before the demo library pack (`content/library/demo`): its items link to these codes,
  and the pack's SQL stops on the first attente it cannot find.

## « À vérifier »

**Everything in this folder is to check** against the official documents:

- Le curriculum de l’Ontario, de la 1re à la 8e année – Mathématiques (2020);
- Français (2023);
- Sciences et technologie (2022).

The lists below name the codes whose number, scope or wording we are least sure of. A reviewer
should check these first. The general points come first:

- **Français structure.** The attente topics (A1 compétences transférables, A2 littératie
  médiatique numérique, A3 applications, liens et contributions; B1 communication orale et non
  verbale, B2 fondements linguistiques, B3 conventions linguistiques; C1–C3; D1 élaboration et
  organisation du contenu, D2 création de textes, D3 publication, présentation et réflexion) and
  the numbering of the contenus follow the parallel English Language (2023) curriculum. The
  French-language Français (2023) document may group or number them differently.
- **Seeded Français C1 block.** The seeded 3e C1 block has predictions and prior knowledge
  (C1.1), the main idea (C1.2) and text features (C1.3). It looks like a mix of two official
  attentes: knowledge about texts and comprehension strategies. It is kept as seeded, and the
  planned 5e codes mirror it. As a result, C2 (stratégies de compréhension) overlaps C1. Fixing
  it means renumbering the seed and the demo pack links together.
- **Seeded Mathématiques 5e B1.6 and B1.7.** In the official list, B1.6 may be about reading and
  representing decimal numbers, and the fraction–decimal links may be B1.9. The seeded meanings
  are kept, so the codes that would clash (the decimals to hundredths, and B1.9) are left out.
- **Strand A label in Sciences et technologie.** « Habiletés en STIM et liens » is our
  translation of _STEM Skills and Connections_. Check the French document's title.
- **Sciences et technologie topics.** We placed these topics in these strands:
  - 3e: plants in B, forces that cause movement in C, strong and stable structures in D, soils in
    E;
  - 5e: human organ systems in B, properties of and changes in matter in C, forces acting on
    structures in D, conservation of energy and resources in E.

  These match the 2007 topics. Check that the 2022 document kept them in the same strands, and
  check the X1 (society and environment) and X2 (understanding) split of each strand.

- **Codes left out on purpose.** The following codes exist in the numbering but are not in the
  files. We were not confident enough of their number or scope. Codes after the last one listed
  for an attente may exist too.
  - `mat-2020-3e`: E2.4.
  - `mat-2020-5e`: B1.4, B2.3, C2.2, D1.4, E1.2, E1.3, E2.1–E2.3, F1.1.
  - `fra-2023-3e` and `fra-2023-5e`: D2.2, D2.4, D2.5.
- **Attentes without contenus.** Mathématiques A1 (apprentissage socioémotionnel) and C4
  (modélisation mathématique) have no contenus in these files. As far as we know, the curriculum
  has none for them either.

### `mat-2020-3e.json`

- **B1.4**, **B1.5**, **E1.2**, **E2.3**, **E2.5**: Number uncertain.
- **B1.6**: Number uncertain; scope or wording uncertain.
- **B2.7**, **C2.2**, **D2.1**, **F1.1**: Scope or wording uncertain.
- **D1.4**: Scope or wording uncertain (the official text may also name the median).

### `mat-2020-5e.json`

- **B1.3**, **B2.5**, **B2.6**, **C2.1**, **C2.3**: Number uncertain; scope or wording uncertain.
- **B1.6**: Seeded code, kept as is: the official number for this content may differ (possibly B1.6 is reading and representing decimal numbers, and comparing them is B1.7).
- **B1.7**: Seeded code, kept as is: the official number for this content may differ (possibly B1.9).
- **B1.8**, **B2.4**, **B2.7**, **D1.1**, **D1.5**, **D1.6**, **E1.4**, **E2.4**, **E2.5**, **F1.2**, **F1.3**: Number uncertain.
- **B2.2**, **C1.1**, **D1.2**, **D1.3**, **D2.1**, **D2.2**, **E1.1**, **F1**: Scope or wording uncertain.

### `fra-2023-3e.json`

- **A1**, **B2**: Scope or wording uncertain.
- **A1.1**, **A2.1**, **A2.2**, **A3.1**, **A3.2**, **B1.1**, **B1.2**, **B2.1**, **B2.2**, **B2.3**, **B3.1**, **B3.2**, **B3.3**, **C1.4**, **C2.1**, **C2.2**, **C2.3**, **C2.4**, **C3.1**, **C3.2**, **D1.2**, **D1.3**, **D2.1**, **D2.3**, **D2.6**, **D3.1**, **D3.2**, **D3.3**: Number estimated from the parallel English Language (2023) structure; confirm in the Français (2023) document.
- **A2**, **A3**, **B1**, **B3**, **C3**, **D2**, **D3**: Attente topic taken from the parallel English Language (2023) structure; confirm in the Français (2023) document.
- **C1**: Seeded code, kept as is: the seeded C1 block (C1.1 predictions and prior knowledge, C1.2 main idea, C1.3 text features) mixes what look like two official attentes (knowledge about texts and comprehension strategies); renumbering it would break the demo item links.
- **C1.1**, **C1.2**, **C1.3**: Seeded code, kept as is: see C1.
- **C2**: Overlaps the seeded C1 (see C1); wording to confirm.
- **D1.1**: Seeded code, kept as is: organizing ideas may be numbered D1.4 in the official document.

### `fra-2023-5e.json`

- **A1**, **B2**: Scope or wording uncertain.
- **A1.1**, **A2.1**, **A2.2**, **A3.1**, **A3.2**, **B1.1**, **B1.2**, **B2.1**, **B2.2**, **B2.3**, **B3.1**, **B3.2**, **B3.3**, **C1.4**, **C2.1**, **C2.2**, **C2.3**, **C2.4**, **C3.1**, **C3.2**, **D1.2**, **D1.3**, **D2.1**, **D2.3**, **D2.6**, **D3.1**, **D3.2**, **D3.3**: Number estimated from the parallel English Language (2023) structure; confirm in the Français (2023) document.
- **A2**, **A3**, **B1**, **B3**, **C3**, **D2**, **D3**: Attente topic taken from the parallel English Language (2023) structure; confirm in the Français (2023) document.
- **C1**: Planned code, kept: same meaning as the seeded 3e C1 (plan C5; listed in PLANNED_EXPECTATIONS); see the 3e C1 note.
- **C1.1**: Same meaning as the seeded 3e C1.1; see the 3e C1 note.
- **C1.2**: Planned code, kept: same meaning as the seeded 3e C1.2 (plan C5; used by the demo item canot-des-voyageurs); see the 3e C1 note.
- **C1.3**: Same meaning as the seeded 3e C1.3; see the 3e C1 note.
- **C2**: Overlaps C1 (see the 3e C1 note); wording to confirm.
- **D1**: Planned code, kept: same meaning as the seeded 3e D1 (plan C5; listed in PLANNED_EXPECTATIONS).
- **D1.1**: Planned code, kept: same meaning as the seeded 3e D1.1 (plan C5); organizing ideas may be numbered D1.4 in the official document.

### `sci-2022-3e.json`

- **A2.1**: Grade-specific coding focus to confirm.
- **A3.1**, **A3.2**, **A3.3**, **B1.1**, **B1.2**, **C1.1**, **C1.2**, **D1.1**, **D1.2**, **E1.1**, **E1.2**: Scope or wording uncertain.
- **B2.3**, **B2.4**, **B2.5**, **C2.1**, **C2.2**, **C2.3**, **D2.1**, **D2.2**, **D2.3**, **E2.1**, **E2.2**, **E2.3**: Number uncertain.

### `sci-2022-5e.json`

- **A2.1**: Grade-specific coding focus to confirm.
- **A3.1**, **A3.2**, **A3.3**, **B1.1**, **B1.2**, **C1**, **C1.1**, **C1.2**, **D1**, **D1.1**, **D1.2**, **E1.1**, **E1.2**: Scope or wording uncertain.
- **B2.1**: Number uncertain; scope or wording uncertain (which organ systems are named).
- **B2.2**, **B2.3**, **C2.1**, **C2.2**, **C2.3**, **C2.4**, **D2.3**, **E2.1**, **E2.2**, **E2.3**, **E2.4**: Number uncertain.
