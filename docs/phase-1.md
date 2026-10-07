# Phase 1: Foundations

## What was built

**Platform**

- Monorepo with CI (lint, format, typecheck, unit tests, database tests, integration tests,
  end-to-end tests in a real browser).
- Full MVP database schema (48 tables) with Row Level Security on every table, explicit grants,
  and 159 pgTAP tests (217 after Phase 2) covering who can see and change what, for every role.
- Roles for everyone in the spec (teacher, principal, VP, office, facilities, board admin, parent),
  scoped to a school or a board. Substitutes get single-day codes in Phase 3, not accounts.
- Module entitlements per school (core, teaching, library, office, safety and building, board
  analytics).
- Append-only audit log. Transactional event outbox with a background worker that delivers
  events to handlers, including mock adapters for PA/bells, doors (VantageCore), intercoms,
  cameras and SMS/voice.
- Invite-only sign-in with a 6-digit email code or a scanner-safe link; French login email.
- French (Canada) UI, with an English toggle on the login page and in Profil (remembered per
  account). Every string is in `apps/web/messages/fr-CA.json` and `en-CA.json`.
- Admin CLI to onboard boards, schools, school years and staff.

**For teachers**

- **Aujourd’hui (today view):** the teacher's own periods for the day, with the calendar applied
  (PA days, early dismissals, masses, assemblies), the next lesson of each subject's active unit,
  and a one-tap "Leçon donnée" with undo. Works for weekly and rotating-day (Jour 1..N) schools,
  rotary teachers and prep coverage. Browse previous and next days.
- **Classes:** create a class (combined grades supported), rename, set its room, manage the class
  team, delete it (type its name to confirm; everything is removed).
- **Élèves:** add students by pasting a list or importing a CSV. The file is read on the device
  and only the first-name column is sent; sensitive columns are refused. Set each student's
  default French level. Safety/medical alerts are encrypted, hidden until revealed, and every
  view is audited (off per school until the principal turns them on).
- **Horaire:** week grid (or cycle days) with subjects, routines, breaks, duties; add a period to
  several days at once; who teaches it and where; overlap warnings.
- **Planification:** units per subject with one active unit, ordered lessons (objectives,
  materials, steps, notes for the substitute, curriculum expectations), reorder with arrows,
  check off, and drafts saved on the device while typing.
- **Calendrier:** school and class events; direction and office manage school events, teachers
  add events for their own classes.
- **École** (direction/office): weekly vs. rotating-day schedule, rotation anchors, turn alerts
  on or off.

## How to run it

See the [README](../README.md). In short:

```bash
pnpm install && cp .env.example apps/web/.env.local
pnpm db:start        # or tools/lite-stack/stack.sh reset (no Docker)
pnpm dev             # http://localhost:3000
```

Codes for demo logins arrive at <http://127.0.0.1:54324>.

## Demo script (about 10 minutes)

1. **Sign in** as `isabelle.tremblay@demo.lynx.test` (3e année). Enter the 6-digit code from the
   mail catcher. Point out: no password, and the emailed link needs a button press, so email
   scanners can't use it up.
2. **Aujourd’hui.** Go to a weekday. Show the routine ("Prière du matin et O Canada"), the
   Français block with the next lesson ("Leçon 4 · Trouver l’idée principale"), and the second
   Français block showing lesson 5. Tap **Leçon donnée**, then **Annuler** in the toast.
3. **Calendar at work.** Go to the coming Friday: the school mass replaces the 9 h 45 block.
   Go to 9 October 2026 (PA day): "Pas de classe".
4. **Élèves.** Show the privacy notice. Tap **Ajouter des élèves → Importer un fichier CSV** with
   a file that has NISO, Nom, Prénom and Date de naissance columns: only "Prénom" can be chosen and
   the others are listed as never sent. Tap **Alerte de sécurité ou médicale** to reveal alerts; add
   one; explain the audit trail.
5. **Horaire.** Show the week grid; add a period to Monday and Wednesday in one step.
6. **Planification.** Open "Lire pour s’informer", show the next-lesson highlight, reorder with
   the arrows, open a lesson: substitute notes and curriculum links ("à vérifier").
7. **Rotary teacher.** Sign in as `paul.leblanc@demo.lynx.test`: his day shows only his Anglais
   (5e) and EPS (3e) periods.
8. **Principal.** Sign in as `sophie.lavoie@demo.lynx.test`: calendar and school settings, no
   teacher planning screens. Switch the school to a 6-day cycle and add an anchor; the teachers'
   today view follows.
9. **On a phone.** Open the site on a phone: bottom navigation, big buttons; "Add to home screen"
   installs it like an app.

## What to test with real teachers

Ask them to do real work, not a tour:

1. **Their real timetable.** Can they enter their actual week in under 15 minutes? Does our model
   fit: weekly vs. Jour 1–N, balanced day, rotary, prep coverage, duties? What's missing or
   confusing?
2. **Their roster.** Import their real class list export (in a test account) and confirm only first
   names come through. How do they handle two students with the same name?
3. **One real unit.** Build a unit they're teaching now. Are the lesson fields the right ones? Is
   "Notes pour la personne suppléante" something they'd fill in?
4. **A week of check-offs.** Use "Aujourd’hui" on their phone for a week. Is one tap fast enough?
   Did they forget, and would a reminder help? Did the next lesson ever look wrong?
5. **Language.** Read every screen. Is the French natural for Ontario schools? Flag anything that
   sounds European, too formal, or anglicized (all text is in `apps/web/messages/fr-CA.json`).
6. **Language levels.** Do Débutant / Intermédiaire / Avancé / Enrichi make sense for their class?
   Would they assign one to every student?
7. **Alerts.** Would their principal and board be comfortable with alerts being stored this way?
   Is "hidden until revealed" right?
8. **What's the one thing they'd want next?**

## Limitations and follow-ups

- No AI features yet (Phase 2); the AI provider is `none`.
- No substitute flow yet (Phase 3); its tables exist and are closed.
- Library tables exist but have no screens or seed items (Phase 4, see DECISIONS.md D-031).
- Principal oversight and audit viewer come in Phase 6; board-admin screens later.
- Kindergarten-specific planning structure is not modelled yet.
- A timetable is one weekly/cycle pattern per class; term-by-term timetable versions come later.
- Offline support is limited to saved drafts; there's no service worker yet.
- `supabase test db` runs in CI on real Supabase (Postgres 17); locally it was also verified on
  Postgres 16 via the lite stack.
