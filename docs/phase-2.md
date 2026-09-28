# Phase 2: AI service and language levels

## What was built

**AI service** (`packages/ai`, run by `apps/worker`)

- One AI module on the server. Claude (Anthropic API) by default, with a fake provider that answers
  locally for development, tests and demos. Model and effort are settings (`AI_MODEL`,
  `AI_EFFORT`); the default is Claude Opus 5.5 at medium effort.
- Requests are jobs in the database, run by the background worker, which alone holds the API key
  and records usage and cost for every call.
- Privacy layer: student and staff names become markers before anything is sent; emails, phone
  numbers, identification numbers, postal codes, addresses and a child's birth date block the
  request; a last check runs on the exact outbound text. See `docs/ai-data-flow.md`.
- Versioned prompts in `prompts/<feature>/<version>.md`, structured answers validated with Zod and
  feature checks, up to three attempts.
- Budgets: a monthly allowance per school (in provider US dollars), pooled per board, with a
  ceiling per school. Usage report for billing: `pnpm admin ai-usage --board <slug> --csv`.
- Evaluation set: 10 fictional texts from Jardin to 8e année with automatic checks
  (`pnpm ai:eval`).

**For teachers: « Différencier »**

- Paste a text, instructions or an activity; choose the grade, subject and 2 to 6 language levels.
- « Vérifier avant d'envoyer » shows exactly what will be sent, with names replaced, and blocks
  personal details.
- The AI prepares one version per level with the same learning goal: title, text, glossary,
  questions, suggested visual supports and a note for the teacher. Everything is editable.
- Print one level or all levels: each level on its own page, with no level name on the student
  copy.
- Save as a private draft (« Mes textes différenciés »), reopen, edit, print or delete it later.
- « Gérer les niveaux »: see the board's levels and add levels of your own.

**For principals**

- École page: turn AI on or off for the school (off by default; audited), with a plain explanation
  of what is sent, and this month's usage against the school's allowance and the board's pool.

## How to run it

```bash
pnpm db:start            # or tools/lite-stack/stack.sh start
pnpm dev                 # web app
pnpm dev:worker          # worker: runs AI jobs (reads apps/web/.env.local)
```

`.env.example` sets `AI_PROVIDER=fake`: everything works without a key, and nothing leaves the
machine. To use Claude, put these in `apps/web/.env.local` (never commit them):

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5-5
AI_EFFORT=medium
```

Then restart the worker. To try the prompts on the evaluation set first (about $1):

```bash
pnpm ai:eval --yes          # report in packages/ai/eval-results/
```

Operator commands:

```bash
pnpm admin set-ai-budget --school <board>/<school> --allowance 100 [--ceiling 200] [--plan plus]
pnpm admin set-ai-board --board <board> [--allowed false] [--pooling false] [--default-allowance 50]
pnpm admin ai-usage --board <board> [--month 2026-10] [--csv]
```

## Demo script (5 minutes)

1. Sign in as the principal (`sophie.lavoie@demo.lynx.test`). Open **École**: AI is off. Read the
   privacy text aloud, then turn AI on.
2. Sign in as a 3e année teacher (`isabelle.tremblay@demo.lynx.test`). Open **Différencier**.
3. Paste a short text that names two students from the class (« Zoé et Samuel observent un castor… »)
   and add a parent's email at the end. Click « Vérifier avant d'envoyer »: the email blocks the
   request. Remove it and check again: the names show as « Élève A » and « Élève B ».
4. Send. The four versions appear side by side (tabs on a phone), with the real names back.
   Open « Voir exactement ce qui a été envoyé » to show no name left the school.
5. Edit a sentence in the Débutant version, print all levels (each on its own page, no level
   name), then save. Show it under « Mes textes différenciés ».
6. Back as the principal, show this month's usage on the École page.

## What to test with real teachers

1. **Quality.** Bring three real texts from this week (a reading, math instructions, a science
   activity). Are the Débutant versions really accessible for ALF/PANA students? Is Enrichi
   actually richer, or just longer? Is the learning goal the same in every version?
2. **French.** Does it read like Ontario French school usage? Flag anything that sounds European,
   too formal, or anglicized.
3. **Levels.** Are the four default level descriptions right for their class? What would they
   add as a level of their own?
4. **Preview.** Is the "what will be sent" step clear and reassuring, or annoying? Did it ever
   miss a name it should have caught (a parent, a sibling)?
5. **Printing.** Would they hand the printouts to students as they are? Is the small number in
   the corner enough to know which sheet is which?
6. **Time saved.** How long would this take by hand? Would they use it weekly?
7. **Principals.** Would their principal and board be comfortable with the privacy explanation?
   What would they ask before turning AI on?
