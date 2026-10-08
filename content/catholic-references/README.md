# Catholic references (import files)

`sample.json` is an example of the file `pnpm admin import-references` loads into a board
(DECISIONS D-147). The format, the rights to the texts and the steps are in
[docs/catholic-references.md](../../docs/catholic-references.md).

**This is a sample, not a board's references.** It says `"sample": true`, and every text is to
check (`sourceNote`: « à vérifier par le conseil »):

- the seven references of the demo seed (`supabase/seed.sql`), with the same types, grades,
  seasons, tags and texts, in the repository's typography (`’`);
- a reflection for the Carême;
- a scripture reference, « Les Béatitudes (Mt 5, 1-12) », with an original summary: the passage
  is cited, never quoted.

The texts are original or paraphrased (D-030): no Bible or liturgical translation, no published
prayer, no Catholic graduate expectation. `"official"` is `false`.

`apps/admin/src/commands/references.test.ts` checks that the file is valid, follows the French
typography rules and still holds the seed's references. To try it on a board:

```bash
pnpm admin import-references --board csc-demo --file content/catholic-references/sample.json   # a dry run
```
