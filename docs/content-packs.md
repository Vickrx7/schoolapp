# Content packs: moving library resources between installs

A **content pack** is one JSON file that carries approved library resources from one install to
another: from IP Lynx's cloud to an install hosted by a school board, or from one board to another.
This page is written for the IT staff of a board that receives packs, and for the operator who
makes them. Decisions: DECISIONS.md, D-099 (the format and what is exported), D-100 (the import)
and D-101 (audit and retention). SPEC §9.3, « On-prem ».

Everything happens in the admin command line (`pnpm admin …`, run from a trusted machine with the
service key in `apps/web/.env.local`). There is no upload screen: an install hosted by a board has
no file storage yet.

## Treat pack files as confidential

A pack holds **answer keys** (quizzes, tests, exit tickets). Anyone who gets the file can read
them. So:

- never put a pack on a public website, a shared drive open to students, or a public link;
- send it by a channel the board trusts (its own file transfer, an encrypted USB key, or e-mail
  inside the board), and delete copies you no longer need;
- the admin CLI writes exported files readable by their owner only.

A pack holds **no personal data**: no user ids, no names, no schools, no student data. Resources
point to the curriculum, language levels, tags and Catholic references by their codes and titles.
Before a pack is written, every text of every resource is checked for the first names of the
exporting board's students and the names of its staff, and for personal details (e-mail
addresses, phone numbers, postal codes…); a resource with one is left out and listed.

## What is in the file

```
{
  "format": "lynx-content-pack", "formatVersion": 1,
  "pack": { "slug", "version", "title", "publisher", "licence", "noDerivatives", "createdAt", "contentSchemaVersion": 1 },
  "levels": [...], "tags": [...], "catholicReferences": [...],
  "items": [ { "key", "hash", "type", "title", ..., "versions": [ { "level", "content", "answerKey" } ] } ],
  "checksum": "…"
}
```

- **`slug` and `version`** name the pack: `lynx-fra-3e` version `2026.2` (a year, a dot and a
  number: `2026.10` comes after `2026.9`).
- Each resource has a stable **`key`**: a later version of the pack finds it again by its key.
- Each resource has a **`hash`**, and the file has a **`checksum`** over all of them. They catch a
  damaged or edited file. They do **not** prove who made it: the publisher is **declared** by the
  file itself. That is why nothing imported reaches teachers until one of the board's own
  reviewers approves it (below). Signed packs will come later.
- The **fingerprint** is the first 12 characters of the file's SHA-256. The CLI prints it when it
  writes or reads a file, and reviewers see it on the resource (« empreinte 3fa4c1d2e9b0 »): ask
  the publisher for it and compare.

## Making a pack (operator)

From a board's approved resources:

```bash
pnpm admin export-pack --board csc-demo --slug lynx-fra-3e --version 2026.2 \
  --title "Ressources IP Lynx, Français 3e année" --publisher "IP Lynx" \
  --licence "Utilisation par le conseil et ses écoles seulement." \
  [--grade 3] [--subject fra] [--no-derivatives] \
  [--include-teacher-items] [--include-pack-items] [--allow-names "Marie,Joseph"] \
  --out lynx-fra-3e-2026.2.json
```

- By default the pack holds the board's **own** approved resources (made by its reviewers,
  generated in bulk, or from packs the same publisher made), never archived ones and never a
  teacher's personal language level.
- `--include-teacher-items` adds approved resources written by teachers. They travel credited to
  the board only, never by name. Confirm who owns them before the pack leaves the board (the CLI
  prints this warning).
- `--include-pack-items` adds resources that came from **another** publisher's pack. Check that
  their licence allows it.
- `--grade` and `--subject` take a code or a list (`--grade 3,5`).
- `--no-derivatives` forbids « Adapter » on the imported resources.
- **Left out for a name:** the report lists each resource and the word found (« Paul »). If the word
  is not a person here (a saint, an apostle, the author of a song), run again with
  `--allow-names "Paul"`. Otherwise fix the resource in the app first.
- **Left out as invalid:** a resource the pack format cannot carry as it is (for example a quiz
  question without its answer). Fix it in the app and export again.
- Each export is recorded in the audit log (`content_pack.exported`, with the slug, version, count
  and the file's SHA-256).

The demo resources of the repository (`content/library/demo`) become a pack with
`pnpm library:pack --version 2026.2 --out dist/lynx-demo-2026.2.json`: the same items, keys and
hashes as the demo seed, so importing it into a demo database finds every resource unchanged.

## Receiving a pack (the board's IT)

### 1. Dry run (the default)

```bash
pnpm admin import-pack --board <board-slug> --file lynx-fra-3e-2026.2.json
```

Nothing is written. The file is checked (a damaged or edited file is refused and nothing is
staged), staged in the database, then the import runs **for real inside a transaction that is
rolled back**, so the report says exactly what `--apply` will do:

```
Dry run: nothing was written. With --apply, lynx-fra-3e-2026.2.json would give:
Pack lynx-fra-3e 2026.2 « Ressources IP Lynx, Français 3e année », declared publisher IP Lynx, fingerprint 3fa4c1d2e9b0.
42 resources: 38 new, 1 updated, 2 unchanged, 1 changed but not applied, 0 modified here and kept, 0 skipped.
Waiting for approval: 35; drafts: 4.
```

followed by one line per resource that is not unchanged, with what did not resolve.

### 2. Apply

```bash
pnpm admin import-pack --board <board-slug> --file lynx-fra-3e-2026.2.json --apply
```

Everything is written in **one transaction**: either the whole pack is imported, or nothing is.
Imported resources:

- belong to the **board** (no author), like the resources its reviewers keep;
- are **private**: teachers do not see them. A resource that is ready for approval waits in
  « Approbation des ressources » with the badge « Ensemble : <title> <version> ». One that is not
  ready stays a **draft**: the report lists each one with what is missing (a level version, an
  attente…). Fix the cause if you can (`--level-map`, a newer curriculum) before `--apply`; the
  board's content reviewers can also open, complete and propose the drafts;
- are never marked « Pour la suppléance »: a reviewer decides that here;
- are **faith content** when the pack says so, when their text has faith words (prière, Jésus,
  Évangile…), when they name a Catholic reference, or when they are Enseignement religieux or a
  « Réflexion catholique »: the board's faith reviewer reviews them first;
- show « Éditeur déclaré : IP Lynx · importé le 3 nov. 2026 · empreinte 3fa4c1d2e9b0 » in their
  « Détails ».

At most **30 new tags** are created per import; the others are dropped (the report lists them).

### Approving in the same step (optional)

```bash
pnpm admin import-pack --board <board-slug> --file … --apply --approve --approver conseillere@conseil.ca
```

The approver must be one of the board's designated content reviewers
(`pnpm admin list-library-reviewers --board <board-slug>`), otherwise nothing is imported
(`LXP04`). Only ready resources are approved, **never** faith content (its faith review comes
first), experiments, STEM challenges or outdoor activities (their safety notes need a person).
Each approval is recorded as the operator's action, with the approver's name and the pack.

### Levels with other codes: `--level-map`

Language levels are matched by code (`debutant`, `intermediaire`, `avance`, `enrichi` on every
new board). If the pack uses codes your board does not have, map them:

```bash
pnpm admin import-pack --board <board-slug> --file … --level-map niveau_1=debutant,niveau_2=intermediaire
```

A version whose level has no match is **skipped** with a warning; a worksheet, reading passage,
exit ticket or quiz then misses a level and stays a draft until someone adds it.

### Curriculum and Catholic references

- An attente is matched on its exact subject, **curriculum version** (`fra-2023`), grade and code.
  An attente your install does not have is a warning; the resource keeps its other attentes.
- A Catholic reference is matched on its type and exact title, first among the board's own, then
  the shared ones. None, or several with that title: the resource is imported without it
  (warning), and a reviewer can pick one.

## Later versions of a pack

Import `2026.3` the same way. Each resource of the new version is compared with the one the pack
created before (by key):

| Report (CLI)                 | In French                | What happens                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new                          | nouvelle                 | Created, as above.                                                                                                                                                                                                                                                                                                      |
| updated                      | mise à jour              | Not approved yet and not edited here since the import: replaced, and back in the approval queue (or a draft).                                                                                                                                                                                                           |
| unchanged                    | inchangée                | The same content as the version imported before: nothing to do.                                                                                                                                                                                                                                                         |
| changed, not applied         | changée, non appliquée   | The pack changed it, but here it is **approved** (or archived). Approved resources are never replaced by a pack. A reviewer compares the two; to take the change, « Retirer de la banque » sends the resource back to be reworked (then edit it), and a withdrawn resource is replaced by the next version of the pack. |
| modified here, kept          | modifiée localement      | Someone here edited it since it was imported. **Local edits win**: the pack's change is not applied.                                                                                                                                                                                                                    |
| deleted here, not re-created | supprimée localement     | A reviewer deleted it here after an earlier version imported it. **Local deletions win too**: it is not created again (see « Getting a deleted resource back » below).                                                                                                                                                  |
| skipped                      | ignorée                  | An unknown subject or type, or no base version: see the warning.                                                                                                                                                                                                                                                        |
| not in this version          | absente de cette version | The new version no longer has it. It stays as it is; archive it in the app if it should go.                                                                                                                                                                                                                             |

- Importing a version that is already applied is refused (`LXP01`); so is a version **older** than
  one already applied (`LXP02`).
- `pnpm admin list-packs --board <board-slug>` lists the packs applied to the board, with their
  fingerprint, counts and the resources « changed, not applied ».

### Getting a deleted resource back

When a resource a pack created is deleted here, the database keeps its pack's name and its key in
`content_pack_removed_items` (the board, the pack's slug and the key: no content, no name), so
the next versions skip it. To take it again from the next version, someone with database access
removes that row, for example:

```sql
delete from public.content_pack_removed_items
where board_id = (select id from public.boards where slug = 'csc-demo')
  and pack_slug = 'lynx-fra-3e' and pack_item_key = 'la-cabane-a-sucre';
```

Each deletion of the board's own resources is also in the audit log (`library_item.deleted`, with
the pack and key).

## Undoing an import

There is no automatic rollback of an applied pack: resources may already be approved, planned in
units or used in substitute plans. To withdraw them, a content reviewer opens each resource (from
the approval queue, or from the search once approved) and uses « Archiver »: archived resources
leave every list and are never touched by a later version of the pack. (« Retirer de la banque »
also takes an approved resource away from teachers, but sends it back to be reworked, and the
next version of the pack would replace it.) A resource that was never approved can be deleted
(« Supprimer le brouillon », once it is a draft, sent back or archived); the deletion is audited
and later versions of the pack do not bring it back.

## Errors

| Code    | Meaning                                                                            | What to do                                                                      |
| ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `LXP01` | This version of the pack is already applied to the board.                          | Nothing: it is there. Use `list-packs`.                                         |
| `LXP02` | A later version of the pack is already applied.                                    | Ask the publisher for the latest version.                                       |
| `LXP03` | The staged import is no longer staged (applied, discarded or expired).             | Run the command again.                                                          |
| `LXP04` | The approver is not one of the board's content reviewers.                          | `pnpm admin list-library-reviewers`, or import without `--approve`.             |
| `LXP05` | Not every resource of the file reached the database (a connection was cut).        | Run the command again.                                                          |
| other   | The file does not validate: the CLI lists each problem with its place in the file. | Ask the publisher for a new file; never edit a pack by hand (its hashes break). |

## Behind the scenes

- The CLI checks the file (`validatePack` in `@lynx/content`), then stages it in the database in
  chunks of 50 resources (`content_pack_stage`, `content_pack_stage_items`). The database checks
  the checksum again, so a cut-short staging cannot be applied.
- `content_pack_preview` is the dry run, `content_pack_apply` the import (one transaction), and
  `content_pack_discard` drops a staged import; the CLI discards after every dry run and every
  failure. Staged imports are deleted after a day in any case.
- Only the operator's service key can call these functions; teachers, principals and reviewers
  cannot, through the app or its API.
- A very large pack could hit the API gateway's time limit on `--apply`. The same functions can
  then be called over a direct database connection by someone with database access.
- Audit log: `content_pack.imported` (the slug, version and counts, deleted-here resources among
  the skipped ones), each approval (`library_item.approved` with `via: content_pack`) and each
  deletion of the board's resources (`library_item.deleted`); the event `content_pack.imported`
  carries the pack's id only.
