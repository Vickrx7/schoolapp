# Catholic references: loading a board's references

A board's **Catholic references** are short texts the app suggests in three places:

- the « Moment de foi » of each day of a substitute plan;
- « Ajouter un lien avec la foi » in the library's editor;
- the faith moment of « Info-parents » (in English too, when the reference has an English text).

A new install has none: the demo's come from `supabase/seed.sql`, which never runs in production.
Until a board has references, those three places stay empty. This page is for the operator who
loads them, and for the board staff who prepare the file. Decisions: DECISIONS.md, D-058 (the
references), D-030 (rights to the texts) and D-146 (this import).

Everything happens in the admin command line (`pnpm admin …` from a trusted machine, or
`docker compose run --rm admin …` on a board-hosted server). There is no screen to edit them yet.

## What a reference is

| Field              | Required | What it is                                                                                                               |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`             | yes      | `virtue`, `graduate_expectation`, `reflection`, `prayer` or `scripture`.                                                 |
| `title`            | yes      | At most 160 characters. With the type, it names the reference: a board has one reference per type and title.             |
| `textFr`           | yes      | The French text, at most 4,000 characters.                                                                               |
| `textEn`           | no       | The English text for « Info-parents », or `null` (the default).                                                          |
| `gradeMin`         | no       | The first grade it suits: `K1`, `K2` or `1` to `8`. `K1` by default.                                                     |
| `gradeMax`         | no       | The last grade it suits. `8` by default.                                                                                 |
| `liturgicalSeason` | no       | `avent`, `noel`, `careme`, `paques` or `temps_ordinaire`; `null` (the default) for any time of the year.                 |
| `tags`             | no       | At most 12 words or short phrases (40 characters each), matched against the day's lessons and subjects. `[]` by default. |
| `sourceNote`       | no       | Where the text comes from, at most 500 characters. Missing: the file's `sourceNote`. `null`: none.                       |
| `active`           | no       | `false` retires the reference: nothing suggests it any more. `true` by default.                                          |

How the app picks one (D-058, D-074): a reference fits when its grades include every grade of the
class (or classes) and its season is the day's, or empty. The one with the most tags found in the
day's lesson titles and subjects comes first, then the board's own before shared ones; references
that tie take turns, day by day. The teacher can always edit or remove what was picked.

## The file

One JSON file per board, in UTF-8. `content/catholic-references/sample.json` is an example:

```json
{
  "sample": false,
  "official": false,
  "sourceNote": "Textes du service d’animation pastorale du conseil.",
  "references": [
    {
      "type": "virtue",
      "title": "Le respect",
      "textFr": "Je traite les autres comme j’aimerais être traité, en paroles et en gestes.",
      "textEn": "I treat others the way I would like to be treated, in words and in actions.",
      "gradeMin": "K1",
      "gradeMax": "8",
      "liturgicalSeason": null,
      "tags": ["respect", "communauté"]
    },
    {
      "type": "scripture",
      "title": "Les Béatitudes (Mt 5, 1-12)",
      "textFr": "Jésus enseigne sur la montagne qui est vraiment heureux : …",
      "gradeMin": "1",
      "sourceNote": "Résumé du conseil; lire le passage dans la traduction approuvée."
    }
  ]
}
```

- **`sample`** (required): `true` for examples that nobody has checked. The command says so before
  anything else.
- **`official`** (required): `true` when the texts are copied from a published source (see
  below). The command then refuses the file without `--confirm-licence`.
- **`sourceNote`**: the note of every reference that does not give its own.
- **`references`**: 1 to 500 references. No field other than those above is accepted.
- Texts are trimmed, and an empty `textEn` or `sourceNote` means none.
- Write in Canadian French: `’` rather than `'`, a no-break space inside « » and before `:`, no
  space before `?`, `!` or `;`. The command lists what to check, without refusing the file.

## Rights to the texts

- Write original texts, or short paraphrases, and **cite** scripture by its reference
  (« Mt 5, 1-12 ») rather than quoting a translation.
- Bible and liturgical translations, published prayers, and the Ontario Catholic School Graduate
  Expectations belong to their publishers or to Catholic education bodies. Load them only with
  written permission (D-030). Such a file says `"official": true`, and the command needs
  `--confirm-licence`; it still prints the warning, so the operator sees what they confirmed.
- Say where each text comes from in `sourceNote`: teachers can read it.

## Loading a file (operator)

Record the access first: the board's admins read it in their audit log (`DEPLOYMENT.md`,
section 10).

```bash
docker compose run --rm admin log-operator-access --board csc-exemple --reason support
# The dry run (the default): checks the file and says what would change.
docker compose run --rm -v "$PWD/references.json:/tmp/references.json:ro" admin \
  import-references --board csc-exemple --file /tmp/references.json
# The same command with --apply writes it.
docker compose run --rm -v "$PWD/references.json:/tmp/references.json:ro" admin \
  import-references --board csc-exemple --file /tmp/references.json --apply
```

From a checkout: `pnpm admin import-references --board csc-exemple --file references.json [--apply]`.
The image holds the sample at `/repo/content/catholic-references/sample.json`.

A dry run reads like this:

```
Fingerprint 3fa4c1d2e9b0 (SHA-256 of /tmp/references.json).
Dry run: nothing was written. With --apply, /tmp/references.json would give Conseil scolaire …:
9 references: 2 new, 1 updated, 6 unchanged.

  new      reflection  « Partager pendant le Carême »
  new      scripture  « Les Béatitudes (Mt 5, 1-12) »
  updated  prayer  « Prière avant le travail » (textFr, tags)

Not in the file, kept as they are (a file retires one with "active": false): 1
  virtue  « La patience »

Run the same command with --apply to import it.
```

- **new**: the board has no reference with this type and title; it is created.
- **updated**: the board has it with another text, grade range, season, tags, source note or
  state; it is rewritten in place, so the plans and library resources that name it keep it. The
  changed fields are in brackets.
- **unchanged**: nothing to write. Importing the same file twice changes nothing.
- **Not in the file**: the board's other references stay as they are.

The whole file is written in one transaction: if one reference is refused, nothing is written.
An import that writes something is recorded in the board's audit log
(« Références catholiques importées », `catholic_references.imported`, with the counts and the
file's SHA-256).

## Later changes

- **To change a text,** edit the file and import it again.
- **To retire a reference,** keep it in the file with `"active": false`. It is never deleted:
  library resources may point to it.
- **To rename one,** add it under its new title and retire the old title (`"active": false`). The
  type and the title are what the import matches on.
- Load the board's references **before a content pack** whose resources name them: a pack's
  resource finds its reference by type and exact title (`docs/content-packs.md`).

## Problems

The command checks the whole file before it reaches the database. Each problem names the
reference by its number in the file, its type and its title:

```
Error: references.json is not a valid Catholic references file (2 problems; nothing was written):
  reference 2 (virtue « La joie »), textFr: required
  reference 7 (virtue « Le respect »), title: reference 1 has the same type and title (a board has one of each)
```

| Message                                      | What to do                                                    |
| -------------------------------------------- | ------------------------------------------------------------- |
| `board "…": not found`                       | Check the slug (`--board`); the command never creates boards. |
| `… is not a valid Catholic references file`  | Fix each listed reference, then run the dry run again.        |
| `This file says its texts are copied from …` | Confirm the permission first, then add `--confirm-licence`.   |
| `cannot read …`                              | Check the path; in Docker, mount the file (`-v`).             |

## Behind the scenes

- `public.catholic_references_import(board, references, sha256, apply)` does the work; only the
  operator's service key can call it. The dry run makes the same writes and rolls them back, so
  its report is exact.
- A board has at most one reference per type and title (a unique index,
  `catholic_references_board_type_title`). Shared references (no board) are IP Lynx's, written
  by migrations only; the import never touches them.
- Migration `20270210090000_catholic_references_import.sql` stops, and names them, if a board
  already has two references with the same type and title: rename or delete the extra rows as
  the database owner, then run the migrations again.
