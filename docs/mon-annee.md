# « Mon année »: the year plan, coverage and the long-range plan

Feature #1 after the pilot build (`beyond.md`'s first shortlist item). Decisions: `DECISIONS.md`
« Mon année », D-123 to D-128, and the amendments written into D-013, D-047, D-053, D-094, D-105,
D-107, D-117 and D-118. Built in three slices on PR #2; the fourth (AI, D-128) is deferred.

| Slice | Commit    | What                                                                                   |
| ----- | --------- | -------------------------------------------------------------------------------------- |
| S1    | `d2dad5a` | Database, domain code, the board's report periods, a unit's planned weeks and attentes |
| S2    | `3615f3e` | « Mon année » (grid and phone list), « Planifier une unité », « Aujourd'hui »'s hint   |
| S3    | `d5ce901` | « Couverture » and « Plan à long terme (PDF) », the docs                               |

## What was built

**For teachers** (the class team; inside a class's « Planification » tab: « Unités · Mon année ·
Couverture »; no new navigation item)

- **A unit's plan** (S1, D-123): on the unit's page, « Prévue du 11 janvier au 5 février » with its
  weeks and school days and the attentes it aims at; « Modifier la planification » opens the
  planning dialog (subject, title, first and last week from the year's weeks with their school
  days, the attentes by grade and domaine with a filter, « À vérifier » on summaries). The lesson
  form lists « Attentes de l'unité » first.
- **« Mon année »** (S2, D-126, `/classes/[id]/planning/year`): on larger screens a table of the
  year's weeks by subject (« Calendrier », « Bulletins », « Temps liturgique », one row per subject,
  a second lane when units share a week), opening on the current week; on phones a list of months.
  Every unit is a button with its status in words. Units without saved dates but with lessons given
  are dated from them (« Enregistrer ces dates »); units without dates are listed with « Placer »;
  overlaps, weeks without school and units outside the year are written out. « Planifier une
  unité » creates a unit « À venir ».
- **« Aujourd'hui »** (S2): a subject block names the planned unit due that week, with
  « Commencer l'unité » (or « Terminer et commencer « … » ») or « Prochaine unité prévue ». Units
  never start by themselves.
- **« Couverture »** (S3, D-125, `/classes/[id]/planning/coverage`): without a subject, the whole
  year per subject (« Français : 32 attentes · 2 enseignées · 2 prévues · 28 pas encore prévues »,
  per grade in a combined class) and the subjects with nothing loaded. With a subject: « Matière »,
  « Année d'études » (combined classes), « Période » (« Toute l'année », the board's report
  periods with their dates, « Dates choisies » with « Du … au … ») and « Afficher » (« Toutes »,
  « Pas encore prévues », « Prévues », « Enseignées »); the attentes by domaine, each overall
  attente the heading of its contenus (« 2 sur 4 enseignées »), each counted attente with its status
  (« Enseignée », « Enseignée (à confirmer) », « Enseignée (unité terminée) », « Prévue »,
  « Enseignée avant la période », « Pas encore prévue ») and its evidence (« 1 leçon donnée
  (dernière le 1er octobre) », the units, each a link). The counts stay whatever « Afficher »
  shows; « Comment on compte » explains them; a notice says the attentes are unverified summaries.
- **« Plan à long terme (PDF) »** (S3, D-127), beside « Planifier une unité » on « Mon année »: page
  1 in landscape, the year at a glance (a column per month: days off and masses, report dates,
  seasons, then each subject's units with their dates); then the units by subject with their
  dates, weeks, school days and attentes (code and text), with any unit dated outside the school
  year under « Hors de l'année scolaire »; and, only when « Inclure la couverture des attentes »
  is ticked, « Couverture des attentes » (the year's counts per subject, with the caveat that only
  the attentes loaded in the app are counted, a summarized list to check that may be incomplete).
  « Ce document est à vous : vous décidez à qui le remettre. » Nothing is sent by the app.

**For board admins** (S1, D-124): « Périodes de bulletin » in « Années scolaires » (the progress
report and the two terms: evaluation window, « saisie au plus tard le », « remise aux familles »),
« Préremplir avec les dates habituelles » (proposes, never saves), and « Périodes de bulletin » in
« Pour bien démarrer le conseil ».

**« Nouveautés »:** `v070`, « Version 0.7 · Mon année » (six items).

**Under the hood**

- Migration `20270111090000_year_plan.sql` (S1): `report_periods`, `units.planned_start_on` and
  `planned_end_on`, `unit_expectations`, `save_unit_plan` and `start_unit` (security invoker), error
  codes `LXY01` to `LXY03`, and the plan-freshness trigger on `units` narrowed with a `when` clause.
  pgTAP `34_year_plan`. Slices S2 and S3 add no migration.
- Domain code `packages/domain/src/year-plan` (S1): school weeks, liturgical bands, placement, the
  usual report dates, coverage (`expectationCoverage`, `coverageCounts`, `taughtExpectationIds`)
  and the planned unit due on « Aujourd'hui ».
- Pure, unit-tested web models: `server/planning/year-view.ts` (S2, the grid, the month list and
  the PDF's months), `server/planning/coverage-view.ts` (S3), `server/pdf/year-plan-model.ts` (S3);
  and `server/curriculum-groups.ts` (S3), the grouping of attentes by domaine shared with the
  library's « Couverture du curriculum » (D-094, whose tests are unchanged).
- Queries under row level security as the teacher: `server/queries/year-plan.ts`,
  `class-coverage.ts`, `year-plan-pdf.ts`. Actions (`server/actions/year-plan.ts`, and the board's
  report periods in `board.ts`) gate through `requireSession()` (D-109).
- No new setting, no new job, no audit action, no AI, no third-party request (the security policy
  check covers « Mon année » and « Couverture »).

## How to run it

```bash
tools/lite-stack/stack.sh reset
pnpm dev                      # or: pnpm --filter @lynx/web build && (cd apps/web && pnpm start)
```

Demo logins (codes in Mailpit, `http://127.0.0.1:54324`): `isabelle.tremblay@demo.lynx.test`
(3e année: Classes → 3e année → Planification → « Mon année » or « Couverture »),
`marc.gagnon@demo.lynx.test` (5e année), `nathalie.roy@demo.lynx.test` (board admin: « Conseil » →
« Années scolaires » → « Périodes de bulletin »).

The seed (`supabase/seeds/50_year_plan_demo.sql`) gives the demo year the usual report periods,
the four demo units their windows around the current week (fixed fall 2026 dates once fewer than six
weeks of the year are left) and attentes, and a planned 3e Mathématiques unit two weeks ahead.
In the demo's 3e Français, « Couverture » shows C1.1 and C1.3 « Enseignée » (lessons given), C1.2
and D1.1 « Prévue » (the unit aims at them) and the other 28 « Pas encore prévue ».

The long-range plan: « Plan à long terme (PDF) » on « Mon année », or
`/classes/<id>/planning/year/pdf` (`?coverage=1` adds coverage, `?download=1` saves the file).

## Data and privacy

- Planned weeks and unit attentes are the class team's planning (D-123): kept with the class (also
  after its students' first names are purged), gone with the unit or class. Report periods are the
  board's calendar (no personal data), gone with their school year (D-124).
- Coverage is computed on each request from the class's units, lessons and progress; nothing is
  stored. The PDF is built when asked and never stored; it reads no student data and prints the
  class team's names, the units' titles as typed and the attentes. Nothing is audited: it is the
  teacher's own planning (D-103 would put it in the operator's audience anyway).
- The direction, office staff and the board's admins never see a class's year plan or coverage
  (D-013). `PRIVACY.md` § 4 and § 16 say so; the pilot terms are unchanged.

## Tests

- Unit (`pnpm test`): the domain's weeks, bands, placement, report periods, coverage and
  « Aujourd'hui » (S1); the year view (S2); the coverage view, the PDF model (month cells, « 1er »,
  no coverage unless asked, no student data: a unit's description never reaches it, and its loaders
  read no student table), the PDF render (`%PDF`, landscape then portrait, a page more with
  coverage), the library coverage view unchanged (S3); the actions' session gate; the catalogues'
  parity, placeholders and French typography.
- pgTAP `34_year_plan` (S1): grants, row level security, `LXY` errors, cascades, the functions, the
  plan-freshness trigger, the student purge.
- Browser (`e2e/year-plan.spec.ts`, `year-plan-mobile.spec.ts`, `unit-plan.spec.ts`, and parts of
  `board-admin`, `board-mobile`, `onboarding` and `operations`): the year view, planning from it,
  « Aujourd'hui », « Couverture » (the statuses the seed gives, a lesson given turning « Prévue »
  into « Enseignée », a report period and chosen dates, « Afficher »), the PDF (`%PDF`, `private,
no-store`, no page policy, 404 for another teacher's class), the report periods, all at 360 px
  too, with axe on every page and dialog.

## Deviations from the plan

- `loadClassCoverage(session, cls, params, locale)` takes the class already loaded (as S2's
  `loadYearPlan`), not its id.
- A combined class shows one grade at a time (« Année d'études » has no « all » choice): the same
  code can be an attente of both grades, and report cards are per grade.
- The overview is always the whole year; the period and « Afficher » apply once a subject is chosen.
- « Afficher » has no choice for « Enseignée avant la période »; it shows under « Toutes ».
- The PDF is opened through a small GET form (the coverage checkbox, then the button) rather than a
  plain link, so it works without JavaScript; its calendar row shows days off and masses only, as
  the grid does. A unit's description is not printed (free text, and not part of a long-range plan).
- `PRIVACY.md` also gets a short paragraph on « Couverture » and the PDF.

## Post-MVP review (2026-10-03)

The review of the three features changed this one in commits `401f593` and `8f07a60` (D-125 and
D-127 have the details):

- Class-wide reads (lesson progress for « Couverture », « Mon année » and « Aujourd'hui », the
  coverage curriculum, the calendar's events) go page by page past PostgREST's 1,000-row cap; the
  lite stack now caps answers at 1,000 rows, as CI and hosted Supabase do.
- The long-range plan PDF lists units dated outside the school year under « Hors de l'année
  scolaire », as the screen does; its coverage page says the list is partial and to be checked,
  « Mode de calcul » replaces a reference to a screen the reader cannot see, and the report
  markers and team roles are lowercase (« saisie 6 nov. », « titulaire »).
- Wording: « Mon année »'s intro says what the grid and the month list really show (days without
  school in the « Calendrier » row, weeks without school greyed out); « à vérifier dans le
  curriculum officiel de l'Ontario »; the PDF option comes before its button; 44 px buttons in the
  report periods dialog and on a unit's page.
- The first browser test of « Mon année » reads the seeded unit's dates, so it passes whichever
  date the seed took.

## Known limits

- **No curriculum in production** (D-030, `DEPLOYMENT.md` § 3.8): until one is loaded, the planning
  dialog has no attentes and « Couverture » says « Aucune attente n'est chargée… ». The year view
  and the PDF still work.
- **The demo curriculum is a partial, unverified summary** (3e and 5e Français, Mathématiques and
  Sciences, the most-used contenus): counts can mislead; the notice and « Comment on compte » say
  so.
- A class with many units in one month can push the year at a glance to a second landscape page.
- No « Reprendre le plan de l'an dernier » (copying a class's units into next year's class): needed
  before August 2027. No drag and drop, no view across classes, no Word or Excel export.
- Report periods are per board and Ontario's three; a school with other dates cannot have its own.
- AI help to spread the attentes over the year is deferred (D-128).

## Questions (answered by the lead for Mike, 2026-10-02; we built on these answers)

Mike has not confirmed these answers yet: `docs/HANDOFF.md` « Decisions waiting for Mike » lists
them for him.

1. Curriculum for pilot teachers: nothing new is loaded; coverage counts the summaries already
   there.
2. Report card dates: typed by whoever administers the board, with « Préremplir avec les dates
   habituelles ».
3. A finished unit counts its attentes as taught, shown as « Enseignée (unité terminée) ».
4. Coverage is off by default in the PDF; the teacher ticks it.
5. No AI for the year plan for now.

## What to test with pilot teachers

1. **In September or January:** open « Mon année » and place the units already under way (accept
   or adjust the dates from the lessons), then plan the rest of the year with attentes. Is a week
   the right step? Are the weeks' labels (« Semaine du 7 septembre (4 jours de classe) ») clear?
   Is the phone's month list enough on the go?
2. **During the year:** does « Aujourd'hui » announce the planned unit at the right time, and is
   one tap to start it what they want (never automatic)?
3. **Before report cards:** « Couverture » filtered by « Bulletin scolaire — 1re étape ». Do the
   statuses match what they know they taught? Is « Enseignée (unité terminée) » right for them, or
   too generous? Do they understand « Enseignée avant la période »? Ask one teacher to spend about
   an hour checking the « à vérifier » attentes of her grade against the official curriculum.
4. **When the principal asks for a long-range plan:** download the PDF with and without coverage.
   Is it what their principal accepts? Is anything missing (descriptions, assessments)? Do they
   want coverage on it at all?
5. **Board admins:** are the usual report dates right for their board, and are three periods per
   year enough?
